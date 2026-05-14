import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskRunner, wireTaskRunnerApproveHook } from '../execution/task-runner-wiring.js';

const taskRunnerState = vi.hoisted(() => ({
  lastOptions: null as any,
}));

vi.mock('@invoker/execution-engine', () => {
  class TaskRunner {
    approveMerge = vi.fn(async () => {});

    constructor(options: unknown) {
      taskRunnerState.lastOptions = options;
    }
  }

  class GitHubMergeGateProvider {}

  class ReviewProviderRegistry {
    registered: unknown[] = [];

    register(provider: unknown): void {
      this.registered.push(provider);
    }
  }

  return {
    TaskRunner,
    GitHubMergeGateProvider,
    ReviewProviderRegistry,
  };
});

describe('task-runner-wiring', () => {
  beforeEach(() => {
    taskRunnerState.lastOptions = null;
  });

  it('keeps heartbeat dispatch routed through persistence and TASK_DELTA publishing', () => {
    const updateTask = vi.fn();
    const publish = vi.fn();
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    createTaskRunner({
      orchestrator: {
        getTask: vi.fn(() => ({
          status: 'running',
          execution: {
            generation: 7,
            lastHeartbeatAt: '2026-05-14T00:00:00.000Z',
          },
        })),
      } as any,
      persistence: {
        updateTask,
      } as any,
      executorRegistry: {} as any,
      executionAgentRegistry: {} as any,
      repoRoot: '/repo',
      invokerConfig: {
        defaultBranch: 'main',
        docker: { imageName: 'img' },
      } as any,
      loadConfig: () => ({}),
      enqueueTaskOutput: vi.fn(),
      flushTaskOutput: vi.fn(),
      taskHandles: new Map(),
      launchingTasks: new Set(),
      logger: logger as any,
      messageBus: {
        publish,
      } as any,
    });

    expect(taskRunnerState.lastOptions).toBeTruthy();
    taskRunnerState.lastOptions.callbacks.onHeartbeat('task-1');

    expect(updateTask).toHaveBeenCalledWith('task-1', {
      execution: { lastHeartbeatAt: expect.any(Date) },
    });
    expect(publish).toHaveBeenCalledWith('task.delta', {
      type: 'updated',
      taskId: 'task-1',
      changes: { execution: { lastHeartbeatAt: expect.any(Date) } },
    });
  });

  it('wires merge approvals through the task runner unless workflow uses external review', async () => {
    let beforeApproveHook: ((task: any) => Promise<void>) | undefined;
    const approveMerge = vi.fn(async () => {});

    wireTaskRunnerApproveHook({
      orchestrator: {
        setBeforeApproveHook: vi.fn((hook) => {
          beforeApproveHook = hook;
        }),
      } as any,
      persistence: {
        loadWorkflow: vi.fn(() => ({ mergeMode: 'auto' })),
      } as any,
      requireTaskExecutor: () => ({
        approveMerge,
      }),
    });

    await beforeApproveHook?.({
      config: { isMergeNode: true, workflowId: 'wf-1' },
      execution: {},
    });

    expect(approveMerge).toHaveBeenCalledWith('wf-1');

    const loadWorkflow = vi.fn(() => ({ mergeMode: 'external_review' }));
    beforeApproveHook = undefined;
    approveMerge.mockClear();

    wireTaskRunnerApproveHook({
      orchestrator: {
        setBeforeApproveHook: vi.fn((hook) => {
          beforeApproveHook = hook;
        }),
      } as any,
      persistence: {
        loadWorkflow,
      } as any,
      requireTaskExecutor: () => ({
        approveMerge,
      }),
    });

    await beforeApproveHook?.({
      config: { isMergeNode: true, workflowId: 'wf-2' },
      execution: {},
    });

    expect(loadWorkflow).toHaveBeenCalledWith('wf-2');
    expect(approveMerge).not.toHaveBeenCalled();
  });
});
