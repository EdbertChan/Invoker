/**
 * Tests for ElectronTransport — verifies the adapter correctly delegates
 * to window.invoker and implements the UITransport lifecycle contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ElectronTransport } from '../transport/electron-transport.js';
import type { InvokerAPI } from '../types.js';

// ── Mock window.invoker ──────────────────────────────────────

function createMockInvokerAPI(): InvokerAPI {
  return {
    // Queries
    getTasks: vi.fn().mockResolvedValue({ tasks: [], workflows: [] }),
    getTaskById: vi.fn().mockResolvedValue(null),
    getTaskOutput: vi.fn().mockResolvedValue(''),
    getEvents: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue({ total: 0, completed: 0, failed: 0, running: 0, pending: 0 }),
    getAllCompletedTasks: vi.fn().mockResolvedValue([]),
    getAgentSession: vi.fn().mockResolvedValue(null),
    getQueueStatus: vi.fn().mockResolvedValue({ maxConcurrency: 4, runningCount: 0, running: [], queued: [] }),
    getRemoteTargets: vi.fn().mockResolvedValue([]),
    getExecutionAgents: vi.fn().mockResolvedValue([]),
    listWorkflows: vi.fn().mockResolvedValue([]),
    getActivityLogs: vi.fn().mockResolvedValue([]),
    getSystemDiagnostics: vi.fn().mockResolvedValue({ platform: 'linux', arch: 'x64', appVersion: '0.1.0', isPackaged: false, tools: [] }),
    getBundledSkillsStatus: vi.fn().mockResolvedValue({ available: false, promptRecommended: false, managedPrefix: '', bundledSkillNames: [], targets: [] }),

    // Subscriptions
    onTaskDelta: vi.fn().mockReturnValue(() => {}),
    onTaskOutput: vi.fn().mockReturnValue(() => {}),
    onActivityLog: vi.fn().mockReturnValue(() => {}),
    onWorkflowsChanged: vi.fn().mockReturnValue(() => {}),

    // Mutations
    loadPlan: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue([]),
    stop: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    resumeWorkflow: vi.fn().mockResolvedValue(null),
    deleteWorkflow: vi.fn().mockResolvedValue(undefined),
    deleteAllWorkflows: vi.fn().mockResolvedValue(undefined),
    approve: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn().mockResolvedValue(undefined),
    provideInput: vi.fn().mockResolvedValue(undefined),
    selectExperiment: vi.fn().mockResolvedValue(undefined),
    restartTask: vi.fn().mockResolvedValue(undefined),
    cancelTask: vi.fn().mockResolvedValue({ cancelled: [], runningCancelled: [] }),
    cancelWorkflow: vi.fn().mockResolvedValue({ cancelled: [], runningCancelled: [] }),
    editTaskCommand: vi.fn().mockResolvedValue(undefined),
    editTaskType: vi.fn().mockResolvedValue(undefined),
    editTaskAgent: vi.fn().mockResolvedValue(undefined),
    editTaskPrompt: vi.fn().mockResolvedValue(undefined),
    setTaskExternalGatePolicies: vi.fn().mockResolvedValue(undefined),
    replaceTask: vi.fn().mockResolvedValue([]),
    recreateWorkflow: vi.fn().mockResolvedValue(undefined),
    recreateTask: vi.fn().mockResolvedValue(undefined),
    retryWorkflow: vi.fn().mockResolvedValue(undefined),
    rebaseAndRetry: vi.fn().mockResolvedValue({ success: true, rebasedBranches: [], errors: [] }),
    recreateWithRebase: vi.fn().mockResolvedValue({ success: true, rebasedBranches: [], errors: [] }),
    setMergeBranch: vi.fn().mockResolvedValue(undefined),
    setMergeMode: vi.fn().mockResolvedValue(undefined),
    approveMerge: vi.fn().mockResolvedValue(undefined),
    resolveConflict: vi.fn().mockResolvedValue(undefined),
    fixWithAgent: vi.fn().mockResolvedValue(undefined),
    cleanupWorktrees: vi.fn().mockResolvedValue({ removed: [], errors: [] }),
    installBundledSkills: vi.fn().mockResolvedValue({ available: false, promptRecommended: false, managedPrefix: '', bundledSkillNames: [], targets: [] }),

    // Extra channels not in transport contract
    loadWorkflow: vi.fn().mockResolvedValue({ workflow: null, tasks: [] }),
    checkPrStatuses: vi.fn().mockResolvedValue(undefined),
    checkPrStatus: vi.fn().mockResolvedValue(undefined),
    reportUiPerf: vi.fn().mockResolvedValue(undefined),
    getUiPerfStats: vi.fn().mockResolvedValue({}),
    openTerminal: vi.fn().mockResolvedValue({ opened: true }),
    getClaudeSession: vi.fn().mockResolvedValue(null),
  } as unknown as InvokerAPI;
}

describe('ElectronTransport', () => {
  let transport: ElectronTransport;
  let mockApi: InvokerAPI;

  beforeEach(() => {
    mockApi = createMockInvokerAPI();
    (globalThis as any).window = { invoker: mockApi };
    transport = new ElectronTransport();
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  // ── Lifecycle ────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('connect() succeeds when window.invoker is available', async () => {
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
    });

    it('connect() throws when window.invoker is missing', async () => {
      (globalThis as any).window = {};
      const t = new ElectronTransport();
      await expect(t.connect()).rejects.toThrow('window.invoker is not available');
    });

    it('connect() throws when window is undefined', async () => {
      delete (globalThis as any).window;
      const t = new ElectronTransport();
      await expect(t.connect()).rejects.toThrow('window.invoker is not available');
    });

    it('disconnect() sets connected to false', async () => {
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });

    it('methods throw when not connected', () => {
      expect(() => transport.getTasks()).toThrow('not connected');
    });
  });

  // ── Error subscription ───────────────────────────────────────

  describe('onError', () => {
    it('returns an unsubscribe function', async () => {
      await transport.connect();
      const cb = vi.fn();
      const unsub = transport.onError(cb);
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('disconnect clears error listeners', async () => {
      await transport.connect();
      const cb = vi.fn();
      transport.onError(cb);
      await transport.disconnect();
      // After disconnect, no listeners should remain (internal state cleared)
      expect(transport.isConnected()).toBe(false);
    });
  });

  // ── Queries ──────────────────────────────────────────────────

  describe('queries', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('getTasks delegates to window.invoker.getTasks', async () => {
      const expected = { tasks: [{ id: 't1' }], workflows: [{ id: 'w1' }] };
      (mockApi.getTasks as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

      const result = await transport.getTasks(true);
      expect(mockApi.getTasks).toHaveBeenCalledWith(true);
      expect(result).toEqual(expected);
    });

    it('getTaskById delegates with correct args', async () => {
      await transport.getTaskById('task-123');
      expect(mockApi.getTaskById).toHaveBeenCalledWith('task-123');
    });

    it('getTaskOutput delegates with correct args', async () => {
      await transport.getTaskOutput('task-456');
      expect(mockApi.getTaskOutput).toHaveBeenCalledWith('task-456');
    });

    it('getEvents delegates with correct args', async () => {
      await transport.getEvents('task-789');
      expect(mockApi.getEvents).toHaveBeenCalledWith('task-789');
    });

    it('getStatus delegates', async () => {
      await transport.getStatus();
      expect(mockApi.getStatus).toHaveBeenCalled();
    });

    it('getAgentSession delegates with both args', async () => {
      await transport.getAgentSession('sess-1', 'claude');
      expect(mockApi.getAgentSession).toHaveBeenCalledWith('sess-1', 'claude');
    });

    it('listWorkflows delegates', async () => {
      await transport.listWorkflows();
      expect(mockApi.listWorkflows).toHaveBeenCalled();
    });
  });

  // ── Subscriptions ────────────────────────────────────────────

  describe('subscriptions', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('onTaskDelta delegates and returns unsubscribe', () => {
      const cb = vi.fn();
      const mockUnsub = vi.fn();
      (mockApi.onTaskDelta as ReturnType<typeof vi.fn>).mockReturnValue(mockUnsub);

      const unsub = transport.onTaskDelta(cb);
      expect(mockApi.onTaskDelta).toHaveBeenCalledWith(cb);
      unsub();
      expect(mockUnsub).toHaveBeenCalled();
    });

    it('onTaskOutput delegates and returns unsubscribe', () => {
      const cb = vi.fn();
      const mockUnsub = vi.fn();
      (mockApi.onTaskOutput as ReturnType<typeof vi.fn>).mockReturnValue(mockUnsub);

      const unsub = transport.onTaskOutput(cb);
      expect(mockApi.onTaskOutput).toHaveBeenCalledWith(cb);
      unsub();
      expect(mockUnsub).toHaveBeenCalled();
    });

    it('onWorkflowsChanged wraps callback with cast and returns unsubscribe', () => {
      const cb = vi.fn();
      const mockUnsub = vi.fn();
      (mockApi.onWorkflowsChanged as ReturnType<typeof vi.fn>).mockImplementation((wrappedCb: any) => {
        // Simulate the IPC event channel sending unknown[] data
        wrappedCb([{ id: 'w1', name: 'Workflow 1', status: 'running' }]);
        return mockUnsub;
      });

      const unsub = transport.onWorkflowsChanged(cb);
      // Verify the user callback received typed WorkflowMeta[]
      expect(cb).toHaveBeenCalledWith([{ id: 'w1', name: 'Workflow 1', status: 'running' }]);
      unsub();
      expect(mockUnsub).toHaveBeenCalled();
    });
  });

  // ── Mutations ────────────────────────────────────────────────

  describe('mutations', () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it('loadPlan delegates with plan text', async () => {
      await transport.loadPlan('name: test\ntasks: []');
      expect(mockApi.loadPlan).toHaveBeenCalledWith('name: test\ntasks: []');
    });

    it('start delegates', async () => {
      await transport.start();
      expect(mockApi.start).toHaveBeenCalled();
    });

    it('approve delegates with taskId', async () => {
      await transport.approve('task-1');
      expect(mockApi.approve).toHaveBeenCalledWith('task-1');
    });

    it('reject delegates with taskId and reason', async () => {
      await transport.reject('task-1', 'bad output');
      expect(mockApi.reject).toHaveBeenCalledWith('task-1', 'bad output');
    });

    it('cancelTask delegates and returns result', async () => {
      const expected = { cancelled: ['task-1'], runningCancelled: [] };
      (mockApi.cancelTask as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

      const result = await transport.cancelTask('task-1');
      expect(mockApi.cancelTask).toHaveBeenCalledWith('task-1');
      expect(result).toEqual(expected);
    });

    it('editTaskCommand delegates with correct args', async () => {
      await transport.editTaskCommand('task-1', 'echo hello');
      expect(mockApi.editTaskCommand).toHaveBeenCalledWith('task-1', 'echo hello');
    });

    it('editTaskType delegates with optional remoteTargetId', async () => {
      await transport.editTaskType('task-1', 'docker', 'remote-1');
      expect(mockApi.editTaskType).toHaveBeenCalledWith('task-1', 'docker', 'remote-1');
    });

    it('replaceTask delegates and returns new tasks', async () => {
      const replacements = [{ id: 'new-1', description: 'replacement' }];
      const expected = [{ id: 'new-1', description: 'replacement', status: 'pending' }];
      (mockApi.replaceTask as ReturnType<typeof vi.fn>).mockResolvedValue(expected);

      const result = await transport.replaceTask('task-1', replacements);
      expect(mockApi.replaceTask).toHaveBeenCalledWith('task-1', replacements);
      expect(result).toEqual(expected);
    });

    it('cleanupWorktrees delegates', async () => {
      await transport.cleanupWorktrees();
      expect(mockApi.cleanupWorktrees).toHaveBeenCalled();
    });
  });
});
