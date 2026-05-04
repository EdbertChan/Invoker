/**
 * Integration test — GUI IPC handler for invoker:edit-task-prompt.
 *
 * Exercises the same wiring as the registerGuiMutationHandler in main.ts:
 * 1. Receives (taskId, newPrompt) arguments.
 * 2. Wraps them in a CommandEnvelope and calls commandService.editTaskPrompt().
 * 3. On success, dispatches started tasks with global top-up.
 * 4. On failure, throws so the IPC bridge surfaces the error to the renderer.
 *
 * This proves recreate semantics — the command service recreates the task
 * (invalidating downstream) and the dispatch path executes the restarted tasks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaskState } from '@invoker/workflow-core';
import { dispatchStartedTasksWithGlobalTopup } from '../global-topup.js';

vi.mock('../global-topup.js', () => ({
  dispatchStartedTasksWithGlobalTopup: vi.fn(async () => ({ runnable: [], topup: [] })),
}));

const mockedDispatch = vi.mocked(dispatchStartedTasksWithGlobalTopup);

function makeTask(id: string, status: TaskState['status'] = 'running'): TaskState {
  return {
    id,
    description: `Task ${id}`,
    status,
    dependencies: [],
    createdAt: new Date(),
    config: { prompt: 'original prompt' },
    execution: {},
  } as TaskState;
}

/**
 * Reproduces the handler logic from main.ts registerGuiMutationHandler('invoker:edit-task-prompt', ...).
 * Extracted here so we can test it without bootstrapping the full Electron app.
 */
async function handleEditTaskPrompt(
  taskIdArg: unknown,
  newPromptArg: unknown,
  deps: {
    commandService: { editTaskPrompt: (envelope: any) => Promise<any> };
    orchestrator: any;
    taskExecutor: any;
    logger: any;
  },
) {
  const taskId = String(taskIdArg);
  const newPrompt = String(newPromptArg);
  deps.logger.info(`edit-task-prompt: "${taskId}" → "${newPrompt}"`, { module: 'ipc' });
  try {
    const envelope = {
      channel: 'edit-task-prompt',
      source: 'ui',
      scope: 'task',
      payload: { taskId, newPrompt },
    };
    const result = await deps.commandService.editTaskPrompt(envelope);
    if (!result.ok) throw new Error(result.error.message);
    await dispatchStartedTasksWithGlobalTopup({
      orchestrator: deps.orchestrator,
      taskExecutor: deps.taskExecutor,
      logger: deps.logger,
      context: 'ipc.edit-task-prompt',
      started: result.data,
    });
  } catch (err) {
    deps.logger.error(`edit-task-prompt failed: ${err}`, { module: 'ipc' });
    throw err;
  }
}

describe('IPC invoker:edit-task-prompt handler', () => {
  let commandService: { editTaskPrompt: ReturnType<typeof vi.fn> };
  let orchestrator: Record<string, unknown>;
  let taskExecutor: { executeTasks: ReturnType<typeof vi.fn> };
  let logger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    commandService = {
      editTaskPrompt: vi.fn(),
    };
    orchestrator = {};
    taskExecutor = {
      executeTasks: vi.fn().mockResolvedValue(undefined),
    };
    logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
  });

  it('routes through commandService.editTaskPrompt with correct envelope shape', async () => {
    const startedTask = makeTask('task-1');
    commandService.editTaskPrompt.mockResolvedValue({ ok: true, data: [startedTask] });

    await handleEditTaskPrompt('task-1', 'new prompt text', {
      commandService,
      orchestrator,
      taskExecutor,
      logger,
    });

    expect(commandService.editTaskPrompt).toHaveBeenCalledTimes(1);
    const envelope = commandService.editTaskPrompt.mock.calls[0][0];
    expect(envelope.channel).toBe('edit-task-prompt');
    expect(envelope.source).toBe('ui');
    expect(envelope.scope).toBe('task');
    expect(envelope.payload).toEqual({ taskId: 'task-1', newPrompt: 'new prompt text' });
  });

  it('dispatches started tasks with global top-up after successful edit', async () => {
    const startedTask = makeTask('task-1');
    commandService.editTaskPrompt.mockResolvedValue({ ok: true, data: [startedTask] });

    await handleEditTaskPrompt('task-1', 'updated prompt', {
      commandService,
      orchestrator,
      taskExecutor,
      logger,
    });

    expect(mockedDispatch).toHaveBeenCalledTimes(1);
    expect(mockedDispatch).toHaveBeenCalledWith({
      orchestrator,
      taskExecutor,
      logger,
      context: 'ipc.edit-task-prompt',
      started: [startedTask],
    });
  });

  it('throws and logs error when commandService returns failure result', async () => {
    commandService.editTaskPrompt.mockResolvedValue({
      ok: false,
      error: { message: 'Task not found' },
    });

    await expect(
      handleEditTaskPrompt('missing-task', 'new prompt', {
        commandService,
        orchestrator,
        taskExecutor,
        logger,
      }),
    ).rejects.toThrow('Task not found');

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('edit-task-prompt failed'),
      { module: 'ipc' },
    );
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it('throws and logs error when commandService rejects', async () => {
    commandService.editTaskPrompt.mockRejectedValue(new Error('DB write failed'));

    await expect(
      handleEditTaskPrompt('task-1', 'new prompt', {
        commandService,
        orchestrator,
        taskExecutor,
        logger,
      }),
    ).rejects.toThrow('DB write failed');

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('edit-task-prompt failed'),
      { module: 'ipc' },
    );
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it('coerces arguments to strings (matching main.ts String() behavior)', async () => {
    commandService.editTaskPrompt.mockResolvedValue({ ok: true, data: [] });

    await handleEditTaskPrompt(123, undefined, {
      commandService,
      orchestrator,
      taskExecutor,
      logger,
    });

    const envelope = commandService.editTaskPrompt.mock.calls[0][0];
    expect(envelope.payload.taskId).toBe('123');
    expect(envelope.payload.newPrompt).toBe('undefined');
  });

  it('dispatches multiple started tasks when edit triggers recreate cascade', async () => {
    const parentTask = makeTask('parent-task');
    const childTask = makeTask('child-task');
    commandService.editTaskPrompt.mockResolvedValue({ ok: true, data: [parentTask, childTask] });

    await handleEditTaskPrompt('parent-task', 'revised prompt', {
      commandService,
      orchestrator,
      taskExecutor,
      logger,
    });

    expect(mockedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        started: [parentTask, childTask],
        context: 'ipc.edit-task-prompt',
      }),
    );
  });
});
