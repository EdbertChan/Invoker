import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Channels } from '@invoker/transport';

const taskRunnerMock = vi.hoisted(() => {
  class MockTaskRunner {
    static instances: MockTaskRunner[] = [];
    options: any;
    approveMerge = vi.fn();

    constructor(options: any) {
      this.options = options;
      MockTaskRunner.instances.push(this);
    }
  }

  return { MockTaskRunner };
});

vi.mock('@invoker/execution-engine', () => {
  class GitHubMergeGateProvider {}
  class ReviewProviderRegistry {
    providers: unknown[] = [];
    register(provider: unknown): void {
      this.providers.push(provider);
    }
  }

  return {
    TaskRunner: taskRunnerMock.MockTaskRunner,
    GitHubMergeGateProvider,
    ReviewProviderRegistry,
  };
});

import { createWiredTaskRunner } from './task-runner-wiring.js';

describe('createWiredTaskRunner', () => {
  beforeEach(() => {
    taskRunnerMock.MockTaskRunner.instances.length = 0;
    vi.clearAllMocks();
  });

  it('preserves task runner dispatch callbacks and heartbeat renderer delta flow', () => {
    let beforeApproveHook: ((task: any) => Promise<void>) | undefined;
    const task = {
      id: 'task-1',
      status: 'running',
      execution: { generation: 2, lastHeartbeatAt: new Date('2026-01-01T00:00:00.000Z') },
    };
    const orchestrator = {
      getTask: vi.fn(() => task),
      setBeforeApproveHook: vi.fn((hook) => {
        beforeApproveHook = hook;
      }),
    };
    const persistence = {
      updateTask: vi.fn(),
      loadWorkflow: vi.fn(() => ({ mergeMode: 'automatic' })),
    };
    const messageBus = {
      publish: vi.fn(),
    };
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const taskHandles = new Map<string, any>();
    const launchingTasks = new Set<string>(['task-1']);
    const enqueueTaskOutput = vi.fn();
    const flushTaskOutput = vi.fn();

    const runner = createWiredTaskRunner({
      orchestrator: orchestrator as any,
      persistence: persistence as any,
      executorRegistry: {} as any,
      executionAgentRegistry: {} as any,
      messageBus: messageBus as any,
      logger: logger as any,
      repoRoot: '/repo',
      invokerConfig: { defaultBranch: 'main', docker: { imageName: 'image' } },
      taskHandles,
      launchingTasks,
      enqueueTaskOutput,
      flushTaskOutput,
    }) as any;

    const instance = taskRunnerMock.MockTaskRunner.instances[0];
    expect(runner).toBe(instance);
    expect(instance.options.orchestrator).toBe(orchestrator);

    instance.options.callbacks.onOutput('task-1', 'hello');
    expect(enqueueTaskOutput).toHaveBeenCalledWith('task-1', 'hello');

    instance.options.callbacks.onSpawned(
      'task-1',
      { executionId: 'exec-1', workspacePath: '/repo/wt', branch: 'feature' },
      { type: 'worktree' },
    );
    expect(launchingTasks.has('task-1')).toBe(false);
    expect(flushTaskOutput).toHaveBeenCalledWith('task-1');
    expect(taskHandles.get('task-1')?.handle.executionId).toBe('exec-1');

    instance.options.callbacks.onHeartbeat('task-1');
    expect(persistence.updateTask).toHaveBeenCalledWith('task-1', {
      execution: { lastHeartbeatAt: expect.any(Date) },
    });
    expect(messageBus.publish).toHaveBeenCalledWith(Channels.TASK_DELTA, {
      type: 'updated',
      taskId: 'task-1',
      changes: { execution: { lastHeartbeatAt: expect.any(Date) } },
    });

    expect(beforeApproveHook).toBeDefined();
  });

  it('keeps merge approval hook behavior equivalent', async () => {
    let beforeApproveHook: ((task: any) => Promise<void>) | undefined;
    const orchestrator = {
      getTask: vi.fn(),
      setBeforeApproveHook: vi.fn((hook) => {
        beforeApproveHook = hook;
      }),
    };
    const persistence = {
      updateTask: vi.fn(),
      loadWorkflow: vi.fn(() => ({ mergeMode: 'automatic' })),
    };

    const runner = createWiredTaskRunner({
      orchestrator: orchestrator as any,
      persistence: persistence as any,
      executorRegistry: {} as any,
      executionAgentRegistry: {} as any,
      messageBus: { publish: vi.fn() } as any,
      logger: { info: vi.fn(), error: vi.fn() } as any,
      repoRoot: '/repo',
      invokerConfig: {},
      taskHandles: new Map(),
      launchingTasks: new Set(),
      enqueueTaskOutput: vi.fn(),
      flushTaskOutput: vi.fn(),
    }) as any;

    await beforeApproveHook?.({
      config: { isMergeNode: true, workflowId: 'wf-1' },
      execution: {},
    });
    expect(runner.approveMerge).toHaveBeenCalledWith('wf-1');

    persistence.loadWorkflow.mockReturnValueOnce({ mergeMode: 'external_review' });
    await beforeApproveHook?.({
      config: { isMergeNode: true, workflowId: 'wf-2' },
      execution: {},
    });
    expect(runner.approveMerge).toHaveBeenCalledTimes(1);
  });
});
