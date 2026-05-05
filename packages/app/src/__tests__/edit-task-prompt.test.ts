/**
 * Integration tests for the prompt-edit IPC + API flow.
 *
 * Verifies that the edit-task-prompt surface:
 * 1. Routes through commandService.editTaskPrompt (mutex-serialized).
 * 2. Dispatches started tasks via taskExecutor.executeTasks (recreate semantics).
 * 3. Does NOT call editTaskCommand (isolation from command-edit path).
 * 4. Performs global top-up after scoped dispatch.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { startApiServer, type ApiServer } from '../api-server.js';

// ── Helpers ──────────────────────────────────────────────────

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1/task-prompt',
    status: 'running' as const,
    description: 'prompt task',
    dependencies: [],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    config: { workflowId: 'wf-1', prompt: 'original prompt' },
    execution: { selectedAttemptId: 'attempt-1' },
    ...overrides,
  };
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode!, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Setup ────────────────────────────────────────────────────

let api: ApiServer;
let port: number;
let mocks: {
  orchestrator: Record<string, ReturnType<typeof vi.fn>>;
  persistence: Record<string, ReturnType<typeof vi.fn>>;
  taskExecutor: Record<string, ReturnType<typeof vi.fn>>;
  killRunningTask: ReturnType<typeof vi.fn>;
};

function createMocks() {
  return {
    orchestrator: {
      getWorkflowStatus: vi.fn(() => ({ total: 1, completed: 0, failed: 0, running: 1, pending: 0 })),
      getAllTasks: vi.fn(() => [makeTask()]),
      startExecution: vi.fn(() => []),
      getTask: vi.fn((id: string) => (id === 'wf-1/task-prompt' ? makeTask() : undefined)),
      editTaskCommand: vi.fn(() => [makeTask()]),
      editTaskPrompt: vi.fn(() => [makeTask()]),
      retryTask: vi.fn(() => [makeTask()]),
      cancelTask: vi.fn(() => ({ cancelled: [], runningCancelled: [] })),
      getQueueStatus: vi.fn(() => ({
        maxConcurrency: 4,
        runningCount: 1,
        running: [{ taskId: 'wf-1/task-prompt', description: 'prompt task' }],
        queued: [],
      })),
    },
    persistence: {
      listWorkflows: vi.fn(() => [{ id: 'wf-1', name: 'test', generation: 1 }]),
      loadWorkflow: vi.fn(() => ({ id: 'wf-1', generation: 1 })),
      updateWorkflow: vi.fn(),
      loadTasks: vi.fn(() => []),
      getEvents: vi.fn(() => []),
      getTaskOutput: vi.fn(() => ''),
    },
    taskExecutor: {
      executeTasks: vi.fn().mockResolvedValue(undefined),
      publishAfterFix: vi.fn().mockResolvedValue(undefined),
      resolveConflict: vi.fn().mockResolvedValue(undefined),
      fixWithAgent: vi.fn().mockResolvedValue(undefined),
      commitApprovedFix: vi.fn().mockResolvedValue(undefined),
    },
    killRunningTask: vi.fn().mockResolvedValue(undefined),
  };
}

beforeAll(async () => {
  mocks = createMocks();
  process.env.INVOKER_API_PORT = '0';
  api = startApiServer({
    orchestrator: mocks.orchestrator as any,
    persistence: mocks.persistence as any,
    executorRegistry: {} as any,
    taskExecutor: mocks.taskExecutor as any,
    killRunningTask: mocks.killRunningTask,
  });
  await new Promise<void>((resolve) => {
    if (api.server.listening) resolve();
    else api.server.on('listening', resolve);
  });
  const addr = api.server.address();
  port = typeof addr === 'object' && addr ? addr.port : api.port;
});

afterAll(async () => {
  await api.close();
  delete process.env.INVOKER_API_PORT;
});

beforeEach(() => {
  for (const group of [mocks.orchestrator, mocks.persistence, mocks.taskExecutor]) {
    for (const fn of Object.values(group)) {
      if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear();
    }
  }
  mocks.killRunningTask.mockClear();

  // Re-apply defaults
  mocks.orchestrator.editTaskPrompt.mockReturnValue([makeTask()]);
  mocks.orchestrator.editTaskCommand.mockReturnValue([makeTask()]);
  mocks.orchestrator.startExecution.mockReturnValue([]);
  mocks.taskExecutor.executeTasks.mockResolvedValue(undefined);
});

// ── Tests ────────────────────────────────────────────────────

describe('POST /api/tasks/:id/edit-prompt — recreate semantics', () => {
  it('routes to orchestrator.editTaskPrompt and dispatches started tasks', async () => {
    const startedTask = makeTask({ status: 'running', execution: { selectedAttemptId: 'attempt-2' } });
    mocks.orchestrator.editTaskPrompt.mockReturnValue([startedTask]);

    const res = await request(port, 'POST', '/api/tasks/wf-1%2Ftask-prompt/edit-prompt', {
      prompt: 'updated prompt text',
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.action).toBe('prompt_edited');
    expect(mocks.orchestrator.editTaskPrompt).toHaveBeenCalledWith('wf-1/task-prompt', 'updated prompt text');
    expect(mocks.taskExecutor.executeTasks).toHaveBeenCalledWith([startedTask]);
  });

  it('does NOT route to editTaskCommand (isolation)', async () => {
    await request(port, 'POST', '/api/tasks/wf-1%2Ftask-prompt/edit-prompt', {
      prompt: 'new prompt',
    });

    expect(mocks.orchestrator.editTaskPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.orchestrator.editTaskCommand).not.toHaveBeenCalled();
  });

  it('performs global top-up after scoped dispatch', async () => {
    const scopedTask = makeTask({
      id: 'wf-1/task-prompt',
      status: 'running',
      execution: { selectedAttemptId: 'attempt-scoped' },
    });
    const topupTask = makeTask({
      id: 'wf-2/task-unrelated',
      status: 'running',
      config: { workflowId: 'wf-2' },
      execution: { selectedAttemptId: 'attempt-topup' },
    });
    mocks.orchestrator.editTaskPrompt.mockReturnValue([scopedTask]);
    mocks.orchestrator.startExecution.mockReturnValue([topupTask]);

    const res = await request(port, 'POST', '/api/tasks/wf-1%2Ftask-prompt/edit-prompt', {
      prompt: 'trigger topup',
    });

    expect(res.status).toBe(200);
    // Scoped dispatch + global top-up = 2 executeTasks calls
    expect(mocks.taskExecutor.executeTasks).toHaveBeenCalledTimes(2);
    expect(mocks.taskExecutor.executeTasks).toHaveBeenNthCalledWith(1, [scopedTask]);
    expect(mocks.taskExecutor.executeTasks).toHaveBeenNthCalledWith(2, [topupTask]);
  });

  it('does not dispatch duplicate attempts from global top-up', async () => {
    const task = makeTask({
      id: 'wf-1/task-prompt',
      status: 'running',
      execution: { selectedAttemptId: 'attempt-same' },
    });
    mocks.orchestrator.editTaskPrompt.mockReturnValue([task]);
    // Global top-up returns the same task/attempt that was already dispatched
    mocks.orchestrator.startExecution.mockReturnValue([task]);

    const res = await request(port, 'POST', '/api/tasks/wf-1%2Ftask-prompt/edit-prompt', {
      prompt: 'no dup',
    });

    expect(res.status).toBe(200);
    // Only 1 dispatch because duplicate is filtered out
    expect(mocks.taskExecutor.executeTasks).toHaveBeenCalledTimes(1);
    expect(mocks.taskExecutor.executeTasks).toHaveBeenCalledWith([task]);
  });

  it('does not trigger retry/recreate/cancel routes (pure prompt edit path)', async () => {
    mocks.orchestrator.recreateTask = vi.fn();
    mocks.orchestrator.recreateWorkflow = vi.fn();
    mocks.orchestrator.cancelWorkflow = vi.fn();

    const res = await request(port, 'POST', '/api/tasks/wf-1%2Ftask-prompt/edit-prompt', {
      prompt: 'isolation check',
    });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('prompt_edited');
    expect(mocks.orchestrator.editTaskPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.orchestrator.retryTask).not.toHaveBeenCalled();
    expect(mocks.orchestrator.recreateTask).not.toHaveBeenCalled();
    expect(mocks.orchestrator.recreateWorkflow).not.toHaveBeenCalled();
    expect(mocks.orchestrator.cancelTask).not.toHaveBeenCalled();
    expect(mocks.orchestrator.cancelWorkflow).not.toHaveBeenCalled();
  });

  it('returns 400 when prompt field is missing', async () => {
    const res = await request(port, 'POST', '/api/tasks/wf-1%2Ftask-prompt/edit-prompt', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing "prompt"');
    expect(mocks.orchestrator.editTaskPrompt).not.toHaveBeenCalled();
    expect(mocks.taskExecutor.executeTasks).not.toHaveBeenCalled();
  });
});
