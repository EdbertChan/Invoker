/**
 * Electron IPC transport adapter.
 *
 * Implements `UITransport` by delegating to `window.invoker` (the preload-exposed
 * IPC bridge). All queries map to ipcRenderer.invoke calls; subscriptions map to
 * ipcRenderer.on event listeners; mutations map to invoke calls with acknowledgement.
 *
 * This adapter preserves existing renderer semantics: getTasks returns the same
 * shape, onTaskDelta delivers the same deltas, and mutations resolve on ack.
 */

import type {
  UITransport,
  UITransportError,
  UITransportErrorCode,
  Unsubscribe,
  WorkflowMeta,
} from '@invoker/contracts';
import type { InvokerAPI } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────

function makeTransportError(code: UITransportErrorCode, message: string, retriable = false): UITransportError {
  return { code, message, retriable };
}

// ── Adapter ──────────────────────────────────────────────────

/**
 * Electron IPC adapter for `UITransport`.
 *
 * Requires `window.invoker` to be available (Electron preload context).
 * Call `connect()` before issuing queries/mutations.
 */
export class ElectronTransport implements UITransport {
  private _connected = false;
  private _errorListeners: Array<(error: UITransportError) => void> = [];

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (typeof window === 'undefined' || !window.invoker) {
      throw Object.assign(
        new Error('window.invoker is not available — not running in Electron renderer'),
        { code: 'CONNECTION_REFUSED' as const },
      );
    }
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this._errorListeners = [];
  }

  isConnected(): boolean {
    return this._connected;
  }

  onError(cb: (error: UITransportError) => void): Unsubscribe {
    this._errorListeners.push(cb);
    return () => {
      this._errorListeners = this._errorListeners.filter((l) => l !== cb);
    };
  }

  // ── Internal ─────────────────────────────────────────────────

  private get api(): InvokerAPI {
    if (!this._connected) {
      throw new Error('ElectronTransport is not connected. Call connect() first.');
    }
    return window.invoker;
  }

  /** Emit a transport-level error to all registered listeners. */
  private emitError(code: UITransportErrorCode, message: string, retriable = false): void {
    const err = makeTransportError(code, message, retriable);
    for (const cb of this._errorListeners) {
      try { cb(err); } catch { /* swallow listener errors */ }
    }
  }

  // ── Queries ──────────────────────────────────────────────────

  getTasks: UITransport['getTasks'] = (forceRefresh) => {
    return this.api.getTasks(forceRefresh);
  };

  getTaskById: UITransport['getTaskById'] = (taskId) => {
    return this.api.getTaskById(taskId);
  };

  getTaskOutput: UITransport['getTaskOutput'] = (taskId) => {
    return this.api.getTaskOutput(taskId);
  };

  getEvents: UITransport['getEvents'] = (taskId) => {
    return this.api.getEvents(taskId);
  };

  getStatus: UITransport['getStatus'] = () => {
    return this.api.getStatus();
  };

  getAllCompletedTasks: UITransport['getAllCompletedTasks'] = () => {
    return this.api.getAllCompletedTasks();
  };

  getAgentSession: UITransport['getAgentSession'] = (sessionId, agentName) => {
    return this.api.getAgentSession(sessionId, agentName);
  };

  getQueueStatus: UITransport['getQueueStatus'] = () => {
    return this.api.getQueueStatus();
  };

  getRemoteTargets: UITransport['getRemoteTargets'] = () => {
    return this.api.getRemoteTargets();
  };

  getExecutionAgents: UITransport['getExecutionAgents'] = () => {
    return this.api.getExecutionAgents();
  };

  listWorkflows: UITransport['listWorkflows'] = () => {
    return this.api.listWorkflows();
  };

  getActivityLogs: UITransport['getActivityLogs'] = () => {
    return this.api.getActivityLogs();
  };

  getSystemDiagnostics: UITransport['getSystemDiagnostics'] = () => {
    return this.api.getSystemDiagnostics();
  };

  getBundledSkillsStatus: UITransport['getBundledSkillsStatus'] = () => {
    return this.api.getBundledSkillsStatus();
  };

  // ── Subscriptions ────────────────────────────────────────────

  onTaskDelta: UITransport['onTaskDelta'] = (cb) => {
    return this.api.onTaskDelta(cb);
  };

  onTaskOutput: UITransport['onTaskOutput'] = (cb) => {
    return this.api.onTaskOutput(cb);
  };

  onActivityLog: UITransport['onActivityLog'] = (cb) => {
    return this.api.onActivityLog(cb);
  };

  onWorkflowsChanged: UITransport['onWorkflowsChanged'] = (cb) => {
    // IPC event channel payload is typed as unknown[]; cast to WorkflowMeta[]
    // to satisfy the transport contract. The main process always sends WorkflowMeta[].
    return this.api.onWorkflowsChanged((data) => cb(data as WorkflowMeta[]));
  };

  // ── Mutations ────────────────────────────────────────────────

  loadPlan: UITransport['loadPlan'] = (planText) => {
    return this.api.loadPlan(planText);
  };

  start: UITransport['start'] = () => {
    return this.api.start();
  };

  stop: UITransport['stop'] = () => {
    return this.api.stop();
  };

  clear: UITransport['clear'] = () => {
    return this.api.clear();
  };

  resumeWorkflow: UITransport['resumeWorkflow'] = () => {
    return this.api.resumeWorkflow();
  };

  deleteWorkflow: UITransport['deleteWorkflow'] = (workflowId) => {
    return this.api.deleteWorkflow(workflowId);
  };

  deleteAllWorkflows: UITransport['deleteAllWorkflows'] = () => {
    return this.api.deleteAllWorkflows();
  };

  approve: UITransport['approve'] = (taskId) => {
    return this.api.approve(taskId);
  };

  reject: UITransport['reject'] = (taskId, reason) => {
    return this.api.reject(taskId, reason);
  };

  provideInput: UITransport['provideInput'] = (taskId, input) => {
    return this.api.provideInput(taskId, input);
  };

  selectExperiment: UITransport['selectExperiment'] = (taskId, experimentId) => {
    return this.api.selectExperiment(taskId, experimentId);
  };

  restartTask: UITransport['restartTask'] = (taskId) => {
    return this.api.restartTask(taskId);
  };

  cancelTask: UITransport['cancelTask'] = (taskId) => {
    return this.api.cancelTask(taskId);
  };

  cancelWorkflow: UITransport['cancelWorkflow'] = (workflowId) => {
    return this.api.cancelWorkflow(workflowId);
  };

  editTaskCommand: UITransport['editTaskCommand'] = (taskId, newCommand) => {
    return this.api.editTaskCommand(taskId, newCommand);
  };

  editTaskType: UITransport['editTaskType'] = (taskId, executorType, remoteTargetId) => {
    return this.api.editTaskType(taskId, executorType, remoteTargetId);
  };

  editTaskAgent: UITransport['editTaskAgent'] = (taskId, agentName) => {
    return this.api.editTaskAgent(taskId, agentName);
  };

  editTaskPrompt: UITransport['editTaskPrompt'] = (taskId, newPrompt) => {
    return this.api.editTaskPrompt(taskId, newPrompt);
  };

  setTaskExternalGatePolicies: UITransport['setTaskExternalGatePolicies'] = (taskId, updates) => {
    return this.api.setTaskExternalGatePolicies(taskId, updates);
  };

  replaceTask: UITransport['replaceTask'] = (taskId, replacementTasks) => {
    return this.api.replaceTask(taskId, replacementTasks);
  };

  recreateWorkflow: UITransport['recreateWorkflow'] = (workflowId) => {
    return this.api.recreateWorkflow(workflowId);
  };

  recreateTask: UITransport['recreateTask'] = (taskId) => {
    return this.api.recreateTask(taskId);
  };

  retryWorkflow: UITransport['retryWorkflow'] = (workflowId) => {
    return this.api.retryWorkflow(workflowId);
  };

  rebaseAndRetry: UITransport['rebaseAndRetry'] = (mergeTaskId) => {
    return this.api.rebaseAndRetry(mergeTaskId);
  };

  recreateWithRebase: UITransport['recreateWithRebase'] = (workflowId) => {
    return this.api.recreateWithRebase(workflowId);
  };

  setMergeBranch: UITransport['setMergeBranch'] = (workflowId, baseBranch) => {
    return this.api.setMergeBranch(workflowId, baseBranch);
  };

  setMergeMode: UITransport['setMergeMode'] = (workflowId, mergeMode) => {
    return this.api.setMergeMode(workflowId, mergeMode);
  };

  approveMerge: UITransport['approveMerge'] = (workflowId) => {
    return this.api.approveMerge(workflowId);
  };

  resolveConflict: UITransport['resolveConflict'] = (taskId, agentName) => {
    return this.api.resolveConflict(taskId, agentName);
  };

  fixWithAgent: UITransport['fixWithAgent'] = (taskId, agentName) => {
    return this.api.fixWithAgent(taskId, agentName);
  };

  cleanupWorktrees: UITransport['cleanupWorktrees'] = () => {
    return this.api.cleanupWorktrees();
  };

  installBundledSkills: UITransport['installBundledSkills'] = (mode) => {
    return this.api.installBundledSkills(mode);
  };
}
