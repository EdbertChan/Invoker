import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Channels } from '@invoker/transport';

const taskRunnerInstances: Array<{
  config: Record<string, any>;
  approveMerge: ReturnType<typeof vi.fn>;
  executeTasks: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('@invoker/execution-engine', () => {
  class MockTaskRunner {
    config: Record<string, any>;
    approveMerge = vi.fn();
    executeTasks = vi.fn();

    constructor(config: Record<string, any>) {
      this.config = config;
      taskRunnerInstances.push(this);
    }
  }

  return {
    TaskRunner: MockTaskRunner,
    GitHubMergeGateProvider: class MockGitHubMergeGateProvider {},
    ReviewProviderRegistry: class MockReviewProviderRegistry {
      register = vi.fn();
    },
  };
});

vi.mock('../workflow-actions.js', () => ({
  autoFixOnReviewGateFailure: vi.fn(),
}));

import { createGuiTaskRunner } from '../execution/task-runner-wiring.js';

function createBaseOptions(overrides: Record<string, unknown> = {}) {
  const beforeApproveHooks: Array<(task: any) => Promise<void>> = [];
  const orchestrator = {
    getTask: vi.fn(() => ({
      status: 'running',
      execution: {
        generation: 3,
        lastHeartbeatAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    })),
    setBeforeApproveHook: vi.fn((hook) => {
      beforeApproveHooks.push(hook);
    }),
  };
  const persistence = {
    updateTask: vi.fn(),
    loadWorkflow: vi.fn(() => ({ mergeMode: 'managed' })),
  };
  const messageBus = {
    publish: vi.fn(),
  };

  return {
    orchestrator,
    persistence,
    executorRegistry: {},
    executionAgentRegistry: {},
    messageBus,
    repoRoot: '/repo',
    invokerConfig: {
      defaultBranch: 'main',
      autoFixCi: false,
      docker: { imageName: 'img' },
    },
    dockerSecretsFile: '/tmp/secrets',
    loadConfig: vi.fn(() => ({ remoteTargets: {}, executionPools: {} })),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() },
    launchingTasks: new Set<string>(),
    taskHandles: new Map(),
    getCurrentTaskRunner: vi.fn(() => taskRunnerInstances[0] as any),
    requireTaskRunner: vi.fn(() => taskRunnerInstances[0] as any),
    enqueueTaskOutput: vi.fn(),
    flushTaskOutput: vi.fn(),
    beforeApproveHooks,
    ...overrides,
  };
}

describe('task runner wiring', () => {
  beforeEach(() => {
    taskRunnerInstances.length = 0;
    vi.clearAllMocks();
  });

  it('creates a TaskRunner with the GUI dispatch dependencies', () => {
    const options = createBaseOptions();

    const runner = createGuiTaskRunner(options as any);

    expect(runner).toBe(taskRunnerInstances[0]);
    expect(taskRunnerInstances[0].executeTasks).toBeTypeOf('function');
    expect(taskRunnerInstances[0].config).toMatchObject({
      orchestrator: options.orchestrator,
      persistence: options.persistence,
      executorRegistry: options.executorRegistry,
      executionAgentRegistry: options.executionAgentRegistry,
      cwd: '/repo',
      defaultBranch: 'main',
      dockerConfig: {
        imageName: 'img',
        secretsFile: '/tmp/secrets',
      },
    });
  });

  it('preserves runner callback side effects for renderer update flow', () => {
    const options = createBaseOptions();
    createGuiTaskRunner(options as any);
    const callbacks = taskRunnerInstances[0].config.callbacks;
    const executor = { type: 'worktree' };
    const handle = { executionId: 'exec-1', workspacePath: '/repo/wt', branch: 'feature' };

    callbacks.onOutput('task-1', 'hello');
    callbacks.onLaunchAccepted('task-1');
    callbacks.onSpawned('task-1', handle, executor);
    callbacks.onHeartbeat('task-1');
    callbacks.onComplete('task-1', {
      status: 'completed',
      executionGeneration: 3,
      outputs: { exitCode: 0 },
    });

    expect(options.enqueueTaskOutput).toHaveBeenCalledWith('task-1', 'hello');
    expect(options.launchingTasks.has('task-1')).toBe(false);
    expect(options.taskHandles.has('task-1')).toBe(false);
    expect(options.flushTaskOutput).toHaveBeenCalledWith('task-1');
    expect(options.persistence.updateTask).toHaveBeenCalledWith('task-1', {
      execution: { lastHeartbeatAt: expect.any(Date) },
    });
    expect(options.messageBus.publish).toHaveBeenCalledWith(Channels.TASK_DELTA, {
      type: 'updated',
      taskId: 'task-1',
      changes: { execution: { lastHeartbeatAt: expect.any(Date) } },
    });
  });

  it('wires merge approvals through the current TaskRunner', async () => {
    const options = createBaseOptions();
    createGuiTaskRunner(options as any);

    await options.beforeApproveHooks[0]({
      config: { isMergeNode: true, workflowId: 'wf-1' },
      execution: {},
    });

    expect(options.requireTaskRunner).toHaveBeenCalled();
    expect(taskRunnerInstances[0].approveMerge).toHaveBeenCalledWith('wf-1');
  });
});
