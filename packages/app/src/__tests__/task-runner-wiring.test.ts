import { describe, expect, it, vi } from 'vitest';
import { Channels } from '@invoker/transport';
import { TaskRunner } from '@invoker/execution-engine';
import { createTaskRunner } from '../execution/task-runner-wiring.js';

describe('task runner wiring extraction', () => {
  it('constructs the GUI task runner with the existing dispatch/callback flow', () => {
    const beforeApproveHooks: Array<(task: any) => Promise<void>> = [];
    const orchestrator = {
      getTask: vi.fn(() => ({
        id: 'task-1',
        status: 'running',
        execution: { generation: 2, lastHeartbeatAt: new Date('2026-01-01T00:00:00.000Z') },
      })),
      setBeforeApproveHook: vi.fn((hook) => {
        beforeApproveHooks.push(hook);
      }),
    };
    const persistence = {
      updateTask: vi.fn(),
      loadWorkflow: vi.fn(() => ({ mergeMode: 'internal' })),
    };
    const messageBus = { publish: vi.fn() };
    const logger = { info: vi.fn(), error: vi.fn() };
    const launchingTasks = new Set<string>();
    const taskHandles = new Map<string, any>();
    const enqueueTaskOutput = vi.fn();
    const flushTaskOutput = vi.fn();

    const taskRunner = createTaskRunner({
      orchestrator: orchestrator as any,
      persistence: persistence as any,
      executorRegistry: {} as any,
      executionAgentRegistry: {} as any,
      messageBus: messageBus as any,
      repoRoot: '/repo',
      invokerConfig: {
        defaultBranch: 'main',
        autoFixCi: false,
      } as any,
      logger: logger as any,
      launchingTasks,
      taskHandles,
      enqueueTaskOutput,
      flushTaskOutput,
      getCurrentTaskRunner: () => taskRunner,
    });

    expect(taskRunner).toBeInstanceOf(TaskRunner);
    expect(orchestrator.setBeforeApproveHook).toHaveBeenCalledTimes(1);

    const callbacks = (taskRunner as any).callbacks;
    callbacks.onOutput('task-1', 'chunk');
    expect(enqueueTaskOutput).toHaveBeenCalledWith('task-1', 'chunk');

    callbacks.onLaunchAccepted('task-1');
    expect(launchingTasks.has('task-1')).toBe(true);

    callbacks.onHeartbeat('task-1');
    expect(persistence.updateTask).toHaveBeenCalledWith('task-1', {
      execution: { lastHeartbeatAt: expect.any(Date) },
    });
    expect(messageBus.publish).toHaveBeenCalledWith(Channels.TASK_DELTA, {
      type: 'updated',
      taskId: 'task-1',
      changes: { execution: { lastHeartbeatAt: expect.any(Date) } },
    });

    const handle = { executionId: 'exec-1', workspacePath: '/repo/wt', branch: 'feature' };
    const executor = { type: 'worktree' };
    callbacks.onSpawned('task-1', handle, executor);
    expect(launchingTasks.has('task-1')).toBe(false);
    expect(flushTaskOutput).toHaveBeenCalledWith('task-1');
    expect(taskHandles.get('task-1')).toEqual({ handle, executor });

    callbacks.onComplete('task-1', {
      status: 'completed',
      executionGeneration: 2,
      outputs: { exitCode: 0 },
    });
    expect(taskHandles.has('task-1')).toBe(false);
  });

  it('keeps merge approvals routed through the current TaskRunner', async () => {
    let beforeApproveHook: ((task: any) => Promise<void>) | undefined;
    const orchestrator = {
      setBeforeApproveHook: vi.fn((hook) => {
        beforeApproveHook = hook;
      }),
    };
    const persistence = {
      loadWorkflow: vi.fn(() => ({ mergeMode: 'internal' })),
    };

    const taskRunner = createTaskRunner({
      orchestrator: orchestrator as any,
      persistence: persistence as any,
      executorRegistry: {} as any,
      executionAgentRegistry: {} as any,
      messageBus: { publish: vi.fn() } as any,
      repoRoot: '/repo',
      invokerConfig: { defaultBranch: 'main', autoFixCi: false } as any,
      logger: { info: vi.fn(), error: vi.fn() } as any,
      launchingTasks: new Set(),
      taskHandles: new Map(),
      enqueueTaskOutput: vi.fn(),
      flushTaskOutput: vi.fn(),
      getCurrentTaskRunner: () => taskRunner,
    });
    const approveMerge = vi.spyOn(taskRunner, 'approveMerge').mockResolvedValue(undefined as any);

    await beforeApproveHook?.({
      config: { isMergeNode: true, workflowId: 'workflow-1' },
      execution: {},
    });

    expect(approveMerge).toHaveBeenCalledWith('workflow-1');
  });
});
