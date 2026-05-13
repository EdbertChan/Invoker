import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Channels } from '@invoker/transport';

const taskRunnerInstances: any[] = [];

vi.mock('@invoker/execution-engine', async () => {
  const actual = await vi.importActual<typeof import('@invoker/execution-engine')>('@invoker/execution-engine');
  return {
    ...actual,
    TaskRunner: vi.fn().mockImplementation((options) => {
      const instance = {
        options,
        approveMerge: vi.fn(async () => undefined),
      };
      taskRunnerInstances.push(instance);
      return instance;
    }),
    GitHubMergeGateProvider: vi.fn().mockImplementation(() => ({})),
    ReviewProviderRegistry: vi.fn().mockImplementation(() => ({
      register: vi.fn(),
    })),
  };
});

describe('task runner wiring extraction', () => {
  beforeEach(() => {
    taskRunnerInstances.length = 0;
  });

  it('keeps task dispatch callbacks and approval hook behavior wired to the same dependencies', async () => {
    let beforeApproveHook: ((task: any) => Promise<void>) | undefined;
    const orchestrator = {
      getTask: vi.fn(() => ({
        id: 'task-1',
        status: 'running',
        execution: { generation: 2, lastHeartbeatAt: new Date(Date.now() - 1000) },
      })),
      setBeforeApproveHook: vi.fn((hook) => {
        beforeApproveHook = hook;
      }),
    };
    const persistence = {
      updateTask: vi.fn(),
      loadWorkflow: vi.fn(() => ({ mergeMode: 'internal' })),
    };
    const messageBus = { publish: vi.fn() };
    const enqueueTaskOutput = vi.fn();
    const flushTaskOutput = vi.fn();
    const launchingTasks = new Set<string>();
    const taskHandles = new Map<string, any>();

    const { createTaskRunnerWiring } = await import('../execution/task-runner-wiring.js');
    const taskRunner = createTaskRunnerWiring({
      orchestrator: orchestrator as any,
      persistence: persistence as any,
      executorRegistry: {} as any,
      executionAgentRegistry: {} as any,
      repoRoot: '/repo',
      invokerConfig: { defaultBranch: 'main' } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      } as any,
      messageBus: messageBus as any,
      enqueueTaskOutput,
      flushTaskOutput,
      launchingTasks,
      taskHandles,
    }) as any;

    const callbacks = taskRunnerInstances[0].options.callbacks;
    callbacks.onOutput('task-1', 'hello');
    expect(enqueueTaskOutput).toHaveBeenCalledWith('task-1', 'hello');

    callbacks.onLaunchStart('task-1', { type: 'worktree' });
    expect(launchingTasks.has('task-1')).toBe(true);

    callbacks.onSpawned('task-1', { executionId: 'exec-1' }, { type: 'worktree' });
    expect(launchingTasks.has('task-1')).toBe(false);
    expect(flushTaskOutput).toHaveBeenCalledWith('task-1');
    expect(taskHandles.get('task-1')).toEqual({
      handle: { executionId: 'exec-1' },
      executor: { type: 'worktree' },
    });

    callbacks.onHeartbeat('task-1');
    expect(persistence.updateTask).toHaveBeenCalledWith('task-1', {
      execution: { lastHeartbeatAt: expect.any(Date) },
    });
    expect(messageBus.publish).toHaveBeenCalledWith(Channels.TASK_DELTA, {
      type: 'updated',
      taskId: 'task-1',
      changes: { execution: { lastHeartbeatAt: expect.any(Date) } },
    });

    callbacks.onComplete('task-1', {
      status: 'completed',
      executionGeneration: 2,
      outputs: { exitCode: 0 },
    });
    expect(taskHandles.has('task-1')).toBe(false);

    expect(beforeApproveHook).toBeDefined();
    await beforeApproveHook?.({
      config: { isMergeNode: true, workflowId: 'wf-1' },
      execution: {},
    });
    expect(taskRunner.approveMerge).toHaveBeenCalledWith('wf-1');

    persistence.loadWorkflow.mockReturnValueOnce({ mergeMode: 'external_review' });
    await beforeApproveHook?.({
      config: { isMergeNode: true, workflowId: 'wf-2' },
      execution: {},
    });
    expect(taskRunner.approveMerge).toHaveBeenCalledTimes(1);
  });
});
