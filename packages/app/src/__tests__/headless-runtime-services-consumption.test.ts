import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeadlessDeps } from '../headless.js';
import { runHeadless } from '../headless.js';

const { openExternalTerminalForTask } = vi.hoisted(() => ({
  openExternalTerminalForTask: vi.fn(),
}));

vi.mock('../open-terminal-for-task.js', () => ({
  openExternalTerminalForTask,
}));

describe('headless runtime service consumption', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  let deps: HeadlessDeps;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    openExternalTerminalForTask.mockReset();
    openExternalTerminalForTask.mockResolvedValue({ opened: false, reason: 'legacy fallback should not run' });

    const noopLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(function () { return noopLogger; }),
    };

    const task = {
      id: 'wf-1/task-1',
      description: 'task',
      status: 'completed',
      dependencies: [],
      config: { workflowId: 'wf-1', runnerKind: 'worktree', isMergeNode: false },
      execution: {},
    };

    deps = {
      logger: noopLogger as any,
      orchestrator: {
        getTask: vi.fn((id: string) => ({ ...task, id })),
        getAllTasks: vi.fn(() => [task]),
        syncFromDb: vi.fn(),
      } as any,
      persistence: {
        listWorkflows: vi.fn(() => [{
          id: 'wf-1',
          name: 'wf-1',
          status: 'completed',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        }]),
        loadTasks: vi.fn(() => [task]),
        getEvents: vi.fn(() => []),
      } as any,
      executorRegistry: {} as any,
      messageBus: {} as any,
      commandService: {} as any,
      repoRoot: '/repo',
      invokerConfig: {} as any,
      initServices: vi.fn(async () => {}),
      wireSlackBot: vi.fn(async () => ({})),
      runtimeServices: {
        workspaceProbe: {
          probeWorkspace: vi.fn(async () => ({ workspacePath: '/tmp/runtime-ws' })),
        },
        containerProbe: {
          probeContainer: vi.fn(async () => ({ containerId: 'ctr-1' })),
        },
        sessionProbe: {
          probeSession: vi.fn(async () => ({ sessionId: 'sess-123', agentName: 'codex' })),
        },
        terminalLauncher: {
          launchTerminal: vi.fn(async () => ({ result: 'attached' })),
        },
      },
      executionAgentRegistry: {
        getSessionDriver: vi.fn(() => ({
          loadSession: vi.fn(() => '{"messages":[]}'),
          parseSession: vi.fn(() => [{ role: 'assistant', content: 'hello from runtime services' }]),
          inspectSession: vi.fn(() => ({ state: 'finished' })),
        })),
      } as any,
    };
  });

  it('uses runtimeServices.sessionProbe for query session before task execution fallbacks', async () => {
    await runHeadless(['query', 'session', 'wf-1/task-1'], deps);

    expect(deps.runtimeServices?.sessionProbe.probeSession).toHaveBeenCalledWith('wf-1/task-1');
    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('agent=codex sessionId=sess-123');
  });

  it('uses runtimeServices.terminalLauncher for open-terminal before the legacy fallback', async () => {
    await runHeadless(['open-terminal', 'wf-1/task-1'], deps);

    expect(deps.runtimeServices?.workspaceProbe.probeWorkspace).toHaveBeenCalledWith('wf-1/task-1');
    expect(deps.runtimeServices?.terminalLauncher.launchTerminal).toHaveBeenCalledWith({
      taskId: 'wf-1/task-1',
      workspacePath: '/tmp/runtime-ws',
      containerId: 'ctr-1',
      sessionId: 'sess-123',
      agentName: 'codex',
    });
    expect(openExternalTerminalForTask).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('Could not open terminal'));
  });
});
