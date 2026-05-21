import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const taskRunnerInstances: Array<{ options: any; approveMerge: ReturnType<typeof vi.fn> }> = [];
  class TaskRunner {
    options: any;
    approveMerge = vi.fn();

    constructor(options: any) {
      this.options = options;
      taskRunnerInstances.push(this);
    }
  }

  return {
    taskRunnerInstances,
    TaskRunner,
    GitHubMergeGateProvider: vi.fn(function GitHubMergeGateProvider() {}),
    ReviewProviderRegistry: vi.fn(function ReviewProviderRegistry(this: { register: ReturnType<typeof vi.fn> }) {
      this.register = vi.fn();
    }),
  };
});

vi.mock('@invoker/execution-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@invoker/execution-engine')>();
  return {
    ...actual,
    TaskRunner: mocks.TaskRunner,
    GitHubMergeGateProvider: mocks.GitHubMergeGateProvider,
    ReviewProviderRegistry: mocks.ReviewProviderRegistry,
  };
});

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    loadConfig: () => ({
      remoteTargets: { remote: {} },
      executionPools: { pool: {} },
      autoFixAgent: 'codex',
      autoApproveAIFixes: true,
    }),
  };
});

const autoFixOnReviewGateFailure = vi.fn();
vi.mock('../workflow-actions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workflow-actions.js')>();
  return {
    ...actual,
    autoFixOnReviewGateFailure: (...args: unknown[]) => autoFixOnReviewGateFailure(...args),
  };
});

import { createGuiTaskRunner } from '../execution/task-runner-wiring.js';

describe('task-runner wiring extraction', () => {
  beforeEach(() => {
    mocks.taskRunnerInstances.length = 0;
    autoFixOnReviewGateFailure.mockReset();
  });

  it('preserves runner callbacks for task handles, output, and heartbeat deltas', async () => {
    let beforeApproveHook: ((task: any) => Promise<void>) | undefined;
    const launchingTasks = new Set<string>();
    const taskHandles = new Map<string, unknown>();
    const enqueueTaskOutput = vi.fn();
    const flushTaskOutput = vi.fn();
    const messageBus = { publish: vi.fn() };
    const persistence = {
      updateTask: vi.fn(),
      loadWorkflow: vi.fn(() => ({ mergeMode: 'automatic' })),
    };
    const orchestrator = {
      getTask: vi.fn(() => ({
        status: 'running',
        execution: { generation: 3, lastHeartbeatAt: new Date('2026-05-21T00:00:00Z') },
      })),
      setBeforeApproveHook: vi.fn((hook) => {
        beforeApproveHook = hook;
      }),
    };
    let taskRunner: any = null;

    taskRunner = createGuiTaskRunner({
      orchestrator: orchestrator as any,
      persistence: persistence as any,
      messageBus: messageBus as any,
      executorRegistry: {} as any,
      executionAgentRegistry: {} as any,
      cwd: '/repo',
      invokerConfig: {
        defaultBranch: 'main',
        autoFixCi: true,
      } as any,
      dockerConfig: { imageName: 'img', secretsFile: '/secrets' },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any,
      launchingTasks,
      taskHandles: taskHandles as any,
      enqueueTaskOutput,
      flushTaskOutput,
      getTaskRunner: () => taskRunner,
    });

    const options = mocks.taskRunnerInstances[0].options;
    expect(options.defaultBranch).toBe('main');
    expect(options.dockerConfig).toEqual({ imageName: 'img', secretsFile: '/secrets' });
    expect(options.remoteTargetsProvider()).toEqual({ remote: {} });
    expect(options.executionPoolsProvider()).toEqual({ pool: {} });

    options.callbacks.onOutput('task-1', 'chunk');
    expect(enqueueTaskOutput).toHaveBeenCalledWith('task-1', 'chunk');

    options.callbacks.onLaunchAccepted('task-1');
    expect(launchingTasks.has('task-1')).toBe(true);

    const handle = { executionId: 'exec-1' };
    const executor = { type: 'worktree' };
    options.callbacks.onSpawned('task-1', handle, executor);
    expect(launchingTasks.has('task-1')).toBe(false);
    expect(taskHandles.get('task-1')).toEqual({ handle, executor });
    expect(flushTaskOutput).toHaveBeenCalledWith('task-1');

    options.callbacks.onHeartbeat('task-1');
    expect(persistence.updateTask).toHaveBeenCalledWith('task-1', {
      execution: { lastHeartbeatAt: expect.any(Date) },
    });
    expect(messageBus.publish).toHaveBeenCalledWith('task.delta', {
      type: 'updated',
      taskId: 'task-1',
      changes: { execution: { lastHeartbeatAt: expect.any(Date) } },
    });

    await beforeApproveHook?.({
      config: { isMergeNode: true, workflowId: 'wf-1' },
      execution: {},
    });
    expect(taskRunner.approveMerge).toHaveBeenCalledWith('wf-1');

    await options.onReviewGateCiFailure({ taskId: 'merge' });
    expect(autoFixOnReviewGateFailure).toHaveBeenCalledWith(
      { taskId: 'merge' },
      expect.objectContaining({ taskExecutor: taskRunner }),
    );
  });
});
