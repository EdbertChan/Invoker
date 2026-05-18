import { describe, expect, it, vi } from 'vitest';
import { Channels } from '@invoker/transport';

const executeTasks = vi.fn();
let lastTaskRunnerConfig: any;

vi.mock('@invoker/execution-engine', () => {
  class TaskRunner {
    config: any;

    constructor(config: any) {
      this.config = config;
      lastTaskRunnerConfig = config;
    }

    executeTasks = executeTasks;
    approveMerge = vi.fn();
  }

  class GitHubMergeGateProvider {}

  class ReviewProviderRegistry {
    register = vi.fn();
  }

  return {
    TaskRunner,
    GitHubMergeGateProvider,
    ReviewProviderRegistry,
  };
});

vi.mock('../config.js', () => ({
  loadConfig: () => ({ remoteTargets: {}, executionPools: {}, autoFixAgent: 'codex', autoApproveAIFixes: false }),
  resolveSecretsFilePath: () => '/tmp/secrets.env',
}));

vi.mock('../workflow-actions.js', () => ({
  autoFixOnReviewGateFailure: vi.fn(),
}));

describe('task runner wiring extraction', () => {
  it('returns the TaskRunner used for task dispatch', async () => {
    const { createGuiTaskRunner } = await import('../execution/task-runner-wiring.js');
    const runner = createGuiTaskRunner(makeOptions());
    const tasks = [{ id: 'task-a' }];

    await runner.executeTasks(tasks as any);

    expect(executeTasks).toHaveBeenCalledWith(tasks);
    expect(lastTaskRunnerConfig.cwd).toBe('/repo');
  });

  it('preserves execution callbacks and task-delta publication flow', async () => {
    const { createGuiTaskRunner } = await import('../execution/task-runner-wiring.js');
    const options = makeOptions();
    createGuiTaskRunner(options);
    const callbacks = lastTaskRunnerConfig.callbacks;

    callbacks.onOutput('task-a', 'hello');
    callbacks.onLaunchAccepted('task-a');
    callbacks.onSpawned('task-a', { executionId: 'exec-1', workspacePath: '/tmp/ws', branch: 'feature' }, { type: 'worktree' });
    callbacks.onHeartbeat('task-a');
    callbacks.onComplete('task-a', {
      status: 'success',
      executionGeneration: 1,
      outputs: { exitCode: 0 },
    });

    expect(options.enqueueTaskOutput).toHaveBeenCalledWith('task-a', 'hello');
    expect(options.flushTaskOutput).toHaveBeenCalledWith('task-a');
    expect(options.taskHandles.has('task-a')).toBe(false);
    expect(options.launchingTasks.has('task-a')).toBe(false);
    expect(options.messageBus.publish).toHaveBeenCalledWith(Channels.TASK_DELTA, {
      type: 'updated',
      taskId: 'task-a',
      changes: { execution: { lastHeartbeatAt: expect.any(Date) } },
    });
  });
});

function makeOptions() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);

  return {
    orchestrator: {
      getTask: vi.fn(() => ({
        status: 'running',
        execution: { generation: 1, lastHeartbeatAt: new Date(Date.now() - 1000) },
      })),
      setBeforeApproveHook: vi.fn(),
    },
    persistence: {
      updateTask: vi.fn(),
      loadWorkflow: vi.fn(),
    },
    executorRegistry: {},
    executionAgentRegistry: {},
    repoRoot: '/repo',
    invokerConfig: {
      defaultBranch: 'main',
      docker: { imageName: 'image' },
      autoFixCi: false,
    },
    logger,
    messageBus: {
      publish: vi.fn(),
    },
    taskHandles: new Map(),
    launchingTasks: new Set<string>(),
    enqueueTaskOutput: vi.fn(),
    flushTaskOutput: vi.fn(),
  } as any;
}
