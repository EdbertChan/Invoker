import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalBus } from '@invoker/transport';
import type { MessageBus } from '@invoker/transport';
import type { CommandService, Orchestrator, TaskState } from '@invoker/workflow-core';
import type { SQLiteAdapter } from '@invoker/data-store';

import type { HeadlessDeps } from '../headless.js';
import { runHeadless } from '../headless.js';
import { trackWorkflow } from '../headless-watch.js';

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function () {
    return noopLogger;
  }),
};

function makeTask(overrides: Partial<TaskState> & { id: string; workflowId?: string } = { id: 'wf-2/task-a' }): TaskState {
  const workflowId = overrides.workflowId ?? overrides.id.split('/')[0] ?? 'wf-2';
  return {
    id: overrides.id,
    description: 'Task',
    status: 'completed',
    dependencies: [],
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    config: {
      workflowId,
      executorType: 'worktree',
      isMergeNode: false,
    },
    execution: {},
    ...overrides,
  } as TaskState;
}

describe('headless watch', () => {
  let bus: LocalBus;
  let deps: HeadlessDeps;
  let currentWorkflowId = 'wf-2';
  let workflowTasks: Record<string, TaskState[]>;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bus = new LocalBus();
    workflowTasks = {
      'wf-1': [makeTask({ id: 'wf-1/task-a', workflowId: 'wf-1' })],
      'wf-2': [makeTask({ id: 'wf-2/task-a', workflowId: 'wf-2', status: 'running' })],
    };

    deps = {
      logger: noopLogger as any,
      orchestrator: {
        syncFromDb: vi.fn((workflowId: string) => {
          currentWorkflowId = workflowId;
        }),
        getAllTasks: vi.fn(() => workflowTasks[currentWorkflowId] ?? []),
        getTask: vi.fn((taskId: string) => (
          Object.values(workflowTasks).flat().find((task) => task.id === taskId)
        )),
      } as unknown as Orchestrator,
      persistence: {
        listWorkflows: vi.fn(() => [
          {
            id: 'wf-2',
            name: 'Latest workflow',
            status: 'running',
            createdAt: '2024-01-02T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
          {
            id: 'wf-1',
            name: 'Older workflow',
            status: 'completed',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ]),
      } as unknown as SQLiteAdapter,
      commandService: {} as CommandService,
      executorRegistry: {} as any,
      messageBus: bus as MessageBus,
      repoRoot: '/tmp/repo',
      invokerConfig: {} as any,
      initServices: vi.fn(async () => {}),
      wireSlackBot: vi.fn(async () => ({})),
    };

    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdout.mockRestore();
    process.exitCode = undefined;
  });

  it('defaults to the latest workflow when no workflowId is provided', async () => {
    setTimeout(() => {
      workflowTasks['wf-2'] = [makeTask({ id: 'wf-2/task-a', workflowId: 'wf-2', status: 'completed' })];
      bus.publish('task.delta', { type: 'updated', taskId: 'wf-2/task-a', changes: { status: 'completed' } });
    }, 20);

    await runHeadless(['watch'], deps);

    expect(deps.orchestrator.syncFromDb).toHaveBeenCalledWith('wf-2');
    expect(stdout.mock.calls.map((call) => String(call[0])).join('')).toContain('wf-2/task-a');
  });

  it('throws when the requested workflow is not found', async () => {
    await expect(runHeadless(['watch', 'wf-missing'], deps)).rejects.toThrow('Workflow "wf-missing" not found.');
  });

  it('prints a snapshot and exits with failure code when the watched workflow fails', async () => {
    workflowTasks['wf-2'] = [makeTask({ id: 'wf-2/task-a', workflowId: 'wf-2', status: 'failed' })];

    await runHeadless(['watch', 'wf-2'], deps);

    const output = stdout.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('Watching workflow: wf-2');
    expect(output).toContain('wf-2/task-a');
    expect(process.exitCode).toBe(1);
  });
});

describe('trackWorkflow', () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdout.mockRestore();
    process.exitCode = undefined;
  });

  it('prints updates when a delta wakes the tracker', async () => {
    const bus = new LocalBus();
    let tasks = [makeTask({ id: 'wf-1/task-a', workflowId: 'wf-1', status: 'running' })];

    const tracking = trackWorkflow({
      workflowId: 'wf-1',
      messageBus: bus,
      loadTasks: () => tasks,
      printSnapshot: true,
      printSummary: false,
      maxWaitMs: 2_000,
    });

    setTimeout(() => {
      tasks = [makeTask({ id: 'wf-1/task-a', workflowId: 'wf-1', status: 'completed' })];
      bus.publish('task.delta', { type: 'updated', taskId: 'wf-1/task-a', changes: { status: 'completed' } });
    }, 20);

    await tracking;

    const output = stdout.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('[running]');
    expect(output).toContain('[completed]');
  });

  it('falls back to polling when no delta arrives', async () => {
    let tasks = [makeTask({ id: 'wf-1/task-a', workflowId: 'wf-1', status: 'running' })];

    const tracking = trackWorkflow({
      workflowId: 'wf-1',
      loadTasks: () => tasks,
      printSnapshot: true,
      printSummary: false,
      maxWaitMs: 2_000,
      pollIntervalMs: 20,
    });

    setTimeout(() => {
      tasks = [makeTask({ id: 'wf-1/task-a', workflowId: 'wf-1', status: 'completed' })];
    }, 30);

    await tracking;

    const output = stdout.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('[running]');
    expect(output).toContain('[completed]');
  });
});
