import { describe, expect, it, vi } from 'vitest';
import { TaskRunner } from '@invoker/execution-engine';
import { Channels } from '@invoker/transport';
import { createGuiTaskRunner } from '../execution/task-runner-wiring.js';

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
};
noopLogger.child.mockReturnValue(noopLogger);

describe('task runner wiring extraction', () => {
  it('returns the GUI TaskRunner with the same output, handle, and heartbeat callbacks', () => {
    let approveHook: ((task: any) => Promise<void>) | undefined;
    const orchestrator = {
      getTask: vi.fn(() => ({
        status: 'running',
        execution: { generation: 2, lastHeartbeatAt: new Date(Date.now() - 1000) },
      })),
      setBeforeApproveHook: vi.fn((hook) => {
        approveHook = hook;
      }),
    };
    const persistence = {
      updateTask: vi.fn(),
      loadWorkflow: vi.fn(),
    };
    const publish = vi.fn();
    const launchingTasks = new Set<string>();
    const taskHandles = new Map<string, any>();
    const enqueueTaskOutput = vi.fn();
    const flushTaskOutput = vi.fn();

    const runner = createGuiTaskRunner({
      orchestrator: orchestrator as any,
      persistence: persistence as any,
      executorRegistry: {} as any,
      executionAgentRegistry: {} as any,
      repoRoot: '/repo',
      invokerConfig: { defaultBranch: 'main' },
      logger: noopLogger,
      messageBus: { publish } as any,
      launchingTasks,
      taskHandles,
      enqueueTaskOutput,
      flushTaskOutput,
    });

    expect(runner).toBeInstanceOf(TaskRunner);
    expect(orchestrator.setBeforeApproveHook).toHaveBeenCalledOnce();
    expect(approveHook).toBeTypeOf('function');

    const callbacks = (runner as any).callbacks;
    callbacks.onOutput('task-1', 'chunk');
    expect(enqueueTaskOutput).toHaveBeenCalledWith('task-1', 'chunk');

    const executor = { type: 'worktree' };
    callbacks.onLaunchStart('task-1', executor);
    expect(launchingTasks.has('task-1')).toBe(true);

    const handle = { executionId: 'exec-1', workspacePath: '/repo/worktree', branch: 'feature' };
    callbacks.onSpawned('task-1', handle, executor);
    expect(launchingTasks.has('task-1')).toBe(false);
    expect(flushTaskOutput).toHaveBeenCalledWith('task-1');
    expect(taskHandles.get('task-1')).toEqual({ handle, executor });

    callbacks.onHeartbeat('task-1');
    expect(persistence.updateTask).toHaveBeenCalledWith('task-1', {
      execution: { lastHeartbeatAt: expect.any(Date) },
    });
    expect(publish).toHaveBeenCalledWith(Channels.TASK_DELTA, {
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
  });

  it('keeps merge approvals routed through TaskRunner.approveMerge unless external review owns the merge', async () => {
    let approveHook: ((task: any) => Promise<void>) | undefined;
    const persistence = {
      loadWorkflow: vi.fn(() => ({ mergeMode: 'local' })),
    };

    const runner = createGuiTaskRunner({
      orchestrator: {
        setBeforeApproveHook: vi.fn((hook) => {
          approveHook = hook;
        }),
        getTask: vi.fn(),
      } as any,
      persistence: persistence as any,
      executorRegistry: {} as any,
      executionAgentRegistry: {} as any,
      repoRoot: '/repo',
      invokerConfig: {},
      logger: noopLogger,
      messageBus: { publish: vi.fn() } as any,
      launchingTasks: new Set(),
      taskHandles: new Map(),
      enqueueTaskOutput: vi.fn(),
      flushTaskOutput: vi.fn(),
    });
    const approveMerge = vi.spyOn(runner, 'approveMerge').mockResolvedValue(undefined as any);

    await approveHook?.({
      config: { isMergeNode: true, workflowId: 'wf-1' },
      execution: {},
    });
    expect(approveMerge).toHaveBeenCalledWith('wf-1');

    persistence.loadWorkflow.mockReturnValue({ mergeMode: 'external_review' });
    await approveHook?.({
      config: { isMergeNode: true, workflowId: 'wf-1' },
      execution: {},
    });
    expect(approveMerge).toHaveBeenCalledTimes(1);
  });
});
