/**
 * Dormant web UI transport adapter — HTTP/WebSocket-backed implementation of UITransport.
 *
 * Feature state: dormant. This adapter is scaffolded but NOT wired into any
 * active codepath. It cannot become active without an explicit feature flag change.
 *
 * Queries and mutations map to REST calls against svc-api.
 * Subscriptions will map to WebSocket message frames (not yet connected).
 *
 * All methods throw while disconnected. The connect/disconnect lifecycle
 * is a no-op stub until a real svc-api transport endpoint exists.
 */

import type {
  UITransport,
  UITransportError,
  UITransportErrorCode,
  Unsubscribe,
  WorkflowMeta,
  WorkflowStatus,
  TaskOutputData,
  ActivityLogEntry,
  TaskEvent,
  AgentSessionData,
  QueueStatus,
  CancelResult,
  TaskReplacementDef,
  ExternalGatePolicyUpdate,
  RebaseAndRetryResult,
  ResumeWorkflowResult,
  WorkflowListEntry,
  CleanupWorktreesResult,
  SystemDiagnostics,
  BundledSkillsStatus,
  BundledSkillsInstallMode,
} from '@invoker/contracts';
import type { TaskState, TaskDelta } from '@invoker/workflow-graph';

export interface WebUITransportConfig {
  /** Base URL for REST API calls (e.g. "http://localhost:3100"). */
  apiBaseUrl: string;
  /** WebSocket URL for push subscriptions (e.g. "ws://localhost:3100/ws"). */
  wsUrl: string;
}

/**
 * Dormant HTTP/WebSocket transport adapter.
 *
 * This class satisfies the UITransport interface with stub implementations.
 * Every query/mutation/subscription method guards on `isConnected()` and
 * throws a structured `UITransportError` when the transport is not connected.
 */
export class WebUITransport implements UITransport {
  private _connected = false;
  private readonly _config: WebUITransportConfig;
  private readonly _errorListeners = new Set<(error: UITransportError) => void>();

  constructor(config: WebUITransportConfig) {
    this._config = config;
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async connect(): Promise<void> {
    // Stub: in future, this will open a WebSocket and verify the REST endpoint.
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this._errorListeners.clear();
  }

  isConnected(): boolean {
    return this._connected;
  }

  onError(cb: (error: UITransportError) => void): Unsubscribe {
    this._errorListeners.add(cb);
    return () => {
      this._errorListeners.delete(cb);
    };
  }

  // ── Queries ──────────────────────────────────────────────────

  async getTasks(_forceRefresh?: boolean): Promise<{ tasks: TaskState[]; workflows: WorkflowMeta[] }> {
    this._guard();
    return { tasks: [], workflows: [] };
  }

  async getTaskById(_taskId: string): Promise<TaskState | null> {
    this._guard();
    return null;
  }

  async getTaskOutput(_taskId: string): Promise<string> {
    this._guard();
    return '';
  }

  async getEvents(_taskId: string): Promise<TaskEvent[]> {
    this._guard();
    return [];
  }

  async getStatus(): Promise<WorkflowStatus> {
    this._guard();
    return { total: 0, completed: 0, failed: 0, running: 0, pending: 0 };
  }

  async getAllCompletedTasks(): Promise<Array<TaskState & { workflowName: string }>> {
    this._guard();
    return [];
  }

  async getAgentSession(_sessionId: string, _agentName?: string): Promise<AgentSessionData | null> {
    this._guard();
    return null;
  }

  async getQueueStatus(): Promise<QueueStatus> {
    this._guard();
    return { maxConcurrency: 0, runningCount: 0, running: [], queued: [] };
  }

  async getRemoteTargets(): Promise<string[]> {
    this._guard();
    return [];
  }

  async getExecutionAgents(): Promise<string[]> {
    this._guard();
    return [];
  }

  async listWorkflows(): Promise<WorkflowListEntry[]> {
    this._guard();
    return [];
  }

  async getActivityLogs(): Promise<ActivityLogEntry[]> {
    this._guard();
    return [];
  }

  async getSystemDiagnostics(): Promise<SystemDiagnostics> {
    this._guard();
    return { platform: 'web', arch: 'unknown', appVersion: '0.0.0', isPackaged: false, tools: [] };
  }

  async getBundledSkillsStatus(): Promise<BundledSkillsStatus> {
    this._guard();
    return { available: false, promptRecommended: false, managedPrefix: '', bundledSkillNames: [], targets: [] };
  }

  // ── Subscriptions ────────────────────────────────────────────

  onTaskDelta(_cb: (delta: TaskDelta) => void): Unsubscribe {
    this._guard();
    // Stub: would register a WS message filter for task deltas.
    return () => {};
  }

  onTaskOutput(_cb: (data: TaskOutputData) => void): Unsubscribe {
    this._guard();
    // Stub: would register a WS message filter for task output.
    return () => {};
  }

  onActivityLog(_cb: (entries: ActivityLogEntry[]) => void): Unsubscribe {
    this._guard();
    return () => {};
  }

  onWorkflowsChanged(_cb: (workflows: WorkflowMeta[]) => void): Unsubscribe {
    this._guard();
    return () => {};
  }

  // ── Mutations ────────────────────────────────────────────────

  async loadPlan(_planText: string): Promise<void> {
    this._guard();
  }

  async start(): Promise<TaskState[]> {
    this._guard();
    return [];
  }

  async stop(): Promise<void> {
    this._guard();
  }

  async clear(): Promise<void> {
    this._guard();
  }

  async resumeWorkflow(): Promise<ResumeWorkflowResult | null> {
    this._guard();
    return null;
  }

  async deleteWorkflow(_workflowId: string): Promise<void> {
    this._guard();
  }

  async deleteAllWorkflows(): Promise<void> {
    this._guard();
  }

  async approve(_taskId: string): Promise<void> {
    this._guard();
  }

  async reject(_taskId: string, _reason?: string): Promise<void> {
    this._guard();
  }

  async provideInput(_taskId: string, _input: string): Promise<void> {
    this._guard();
  }

  async selectExperiment(_taskId: string, _experimentId: string | string[]): Promise<void> {
    this._guard();
  }

  async restartTask(_taskId: string): Promise<void> {
    this._guard();
  }

  async cancelTask(_taskId: string): Promise<CancelResult> {
    this._guard();
    return { cancelled: [], runningCancelled: [] };
  }

  async cancelWorkflow(_workflowId: string): Promise<CancelResult> {
    this._guard();
    return { cancelled: [], runningCancelled: [] };
  }

  async editTaskCommand(_taskId: string, _newCommand: string): Promise<void> {
    this._guard();
  }

  async editTaskType(_taskId: string, _executorType: string, _remoteTargetId?: string): Promise<void> {
    this._guard();
  }

  async editTaskAgent(_taskId: string, _agentName: string): Promise<void> {
    this._guard();
  }

  async editTaskPrompt(_taskId: string, _newPrompt: string): Promise<void> {
    this._guard();
  }

  async setTaskExternalGatePolicies(_taskId: string, _updates: ExternalGatePolicyUpdate[]): Promise<void> {
    this._guard();
  }

  async replaceTask(_taskId: string, _replacementTasks: TaskReplacementDef[]): Promise<TaskState[]> {
    this._guard();
    return [];
  }

  async recreateWorkflow(_workflowId: string): Promise<void> {
    this._guard();
  }

  async recreateTask(_taskId: string): Promise<void> {
    this._guard();
  }

  async retryWorkflow(_workflowId: string): Promise<void> {
    this._guard();
  }

  async rebaseAndRetry(_mergeTaskId: string): Promise<RebaseAndRetryResult> {
    this._guard();
    return { success: true, rebasedBranches: [], errors: [] };
  }

  async recreateWithRebase(_workflowId: string): Promise<RebaseAndRetryResult> {
    this._guard();
    return { success: true, rebasedBranches: [], errors: [] };
  }

  async setMergeBranch(_workflowId: string, _baseBranch: string): Promise<void> {
    this._guard();
  }

  async setMergeMode(_workflowId: string, _mergeMode: string): Promise<void> {
    this._guard();
  }

  async approveMerge(_workflowId: string): Promise<void> {
    this._guard();
  }

  async resolveConflict(_taskId: string, _agentName?: string): Promise<void> {
    this._guard();
  }

  async fixWithAgent(_taskId: string, _agentName?: string): Promise<void> {
    this._guard();
  }

  async cleanupWorktrees(): Promise<CleanupWorktreesResult> {
    this._guard();
    return { removed: [], errors: [] };
  }

  async installBundledSkills(_mode?: BundledSkillsInstallMode): Promise<BundledSkillsStatus> {
    this._guard();
    return { available: false, promptRecommended: false, managedPrefix: '', bundledSkillNames: [], targets: [] };
  }

  // ── Internal helpers ─────────────────────────────────────────

  /**
   * Throws a structured error if the transport is not connected.
   * Every public query/mutation/subscription method calls this first.
   */
  private _guard(): void {
    if (!this._connected) {
      const error: UITransportError = {
        code: 'CONNECTION_REFUSED' as UITransportErrorCode,
        message: 'WebUITransport is not connected. Call connect() first.',
        retriable: false,
      };
      throw error;
    }
  }
}
