import { describe, it, expect, vi } from 'vitest';
import type {
  UITransport,
  UITransportQueries,
  UITransportSubscriptions,
  UITransportMutations,
  UITransportError,
  UITransportErrorCode,
  Unsubscribe,
} from '../index.js';

/**
 * Tests for dormant UI transport contract interfaces.
 *
 * These tests verify:
 * 1. Interfaces are assignable (type-level contract validation)
 * 2. Sub-interfaces (queries, subscriptions, mutations) compose into UITransport
 * 3. Error types are well-formed
 * 4. No coupling to Electron IPC or InvokerAPI
 *
 * Feature state: dormant — no adapter implements these interfaces yet.
 */

describe('ui-transport (dormant)', () => {
  describe('Unsubscribe', () => {
    it('is a callable function returning void', () => {
      const unsub: Unsubscribe = vi.fn();
      unsub();
      expect(unsub).toHaveBeenCalledOnce();
    });
  });

  describe('UITransportError', () => {
    it('accepts all error codes', () => {
      const codes: UITransportErrorCode[] = [
        'CONNECTION_LOST',
        'CONNECTION_REFUSED',
        'PROTOCOL_ERROR',
        'TIMEOUT',
        'UNAUTHORIZED',
      ];
      for (const code of codes) {
        const err: UITransportError = { code, message: `Test ${code}`, retriable: code !== 'UNAUTHORIZED' };
        expect(err.code).toBe(code);
        expect(err.message).toContain('Test');
        expect(typeof err.retriable).toBe('boolean');
      }
    });
  });

  describe('UITransportQueries', () => {
    it('is implementable with mock functions', async () => {
      const queries: UITransportQueries = {
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
        getSystemDiagnostics: vi.fn().mockResolvedValue({ platform: 'linux', arch: 'x64', appVersion: '0.0.0', isPackaged: false, tools: [] }),
        getBundledSkillsStatus: vi.fn().mockResolvedValue({ available: false, promptRecommended: false, managedPrefix: '', bundledSkillNames: [], targets: [] }),
      };

      const result = await queries.getTasks();
      expect(result).toEqual({ tasks: [], workflows: [] });
      expect(await queries.getTaskById('t1')).toBeNull();
    });
  });

  describe('UITransportSubscriptions', () => {
    it('is implementable with mock functions returning unsubscribe handles', () => {
      const subs: UITransportSubscriptions = {
        onTaskDelta: vi.fn().mockReturnValue(vi.fn()),
        onTaskOutput: vi.fn().mockReturnValue(vi.fn()),
        onActivityLog: vi.fn().mockReturnValue(vi.fn()),
        onWorkflowsChanged: vi.fn().mockReturnValue(vi.fn()),
      };

      const unsub = subs.onTaskDelta(() => {});
      expect(typeof unsub).toBe('function');
    });
  });

  describe('UITransportMutations', () => {
    it('is implementable with mock functions', async () => {
      const mutations: UITransportMutations = {
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
      };

      await mutations.approve('task-1');
      expect(mutations.approve).toHaveBeenCalledWith('task-1');
    });
  });

  describe('UITransport (composite)', () => {
    it('is implementable by combining all sub-interfaces', () => {
      const transport: UITransport = {
        // Lifecycle
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(false),
        onError: vi.fn().mockReturnValue(vi.fn()),

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
        getSystemDiagnostics: vi.fn().mockResolvedValue({ platform: 'linux', arch: 'x64', appVersion: '0.0.0', isPackaged: false, tools: [] }),
        getBundledSkillsStatus: vi.fn().mockResolvedValue({ available: false, promptRecommended: false, managedPrefix: '', bundledSkillNames: [], targets: [] }),

        // Subscriptions
        onTaskDelta: vi.fn().mockReturnValue(vi.fn()),
        onTaskOutput: vi.fn().mockReturnValue(vi.fn()),
        onActivityLog: vi.fn().mockReturnValue(vi.fn()),
        onWorkflowsChanged: vi.fn().mockReturnValue(vi.fn()),

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
      };

      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('no coupling to InvokerAPI or Electron', () => {
    it('ui-transport exports are independent of ipc-channels invoke/event registries', async () => {
      const transportExports = await import('../ui-transport.js');
      const transportKeys = Object.keys(transportExports);
      // ui-transport is pure types — no runtime exports
      expect(transportKeys).toHaveLength(0);
    });
  });
});
