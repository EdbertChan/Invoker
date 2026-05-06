/**
 * UI Transport Contract — transport-agnostic interfaces for renderer ↔ backend communication.
 *
 * Three operation categories used by renderer hooks today:
 *   1. Queries  — request/response fetches (task list, status, output).
 *   2. Subscriptions — push-based streams (task deltas, output chunks, workflow changes).
 *   3. Mutations — fire-and-forget or acknowledged commands (approve, reject, edit).
 *
 * Adapters implement `UITransport` for each transport:
 *   - Electron IPC: wraps ipcRenderer.invoke / ipcRenderer.on.
 *   - HTTP + WebSocket: REST calls for queries/mutations, WS for subscriptions.
 *
 * Feature state: dormant — defines the contract only. No adapter implementations
 * or active codepaths reference these types yet.
 */

import type { TaskState, TaskDelta } from '@invoker/workflow-graph';
import type {
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
} from './ipc-channels.js';

// ── Dispose handle ──────────────────────────────────────────

/** Callback returned by subscription methods. Calling it unsubscribes. */
export type Unsubscribe = () => void;

// ── Query interface ─────────────────────────────────────────

/**
 * Read-only queries the renderer issues against backend state.
 * Every method returns a Promise — the transport decides whether
 * that's an IPC invoke, an HTTP GET, or a local cache hit.
 */
export interface UITransportQueries {
  /** Fetch current task list and workflow metadata snapshot. */
  getTasks(forceRefresh?: boolean): Promise<{ tasks: TaskState[]; workflows: WorkflowMeta[] }>;

  /** Fetch a single task by ID. */
  getTaskById(taskId: string): Promise<TaskState | null>;

  /** Fetch the output log for a task. */
  getTaskOutput(taskId: string): Promise<string>;

  /** Fetch lifecycle events for a task. */
  getEvents(taskId: string): Promise<TaskEvent[]>;

  /** Fetch aggregate workflow status counters. */
  getStatus(): Promise<WorkflowStatus>;

  /** Fetch all completed tasks across workflows. */
  getAllCompletedTasks(): Promise<Array<TaskState & { workflowName: string }>>;

  /** Fetch an agent/Claude session transcript. */
  getAgentSession(sessionId: string, agentName?: string): Promise<AgentSessionData | null>;

  /** Fetch the execution queue status. */
  getQueueStatus(): Promise<QueueStatus>;

  /** List available remote execution targets. */
  getRemoteTargets(): Promise<string[]>;

  /** List available execution agents. */
  getExecutionAgents(): Promise<string[]>;

  /** List persisted workflows. */
  listWorkflows(): Promise<WorkflowListEntry[]>;

  /** Fetch activity log entries. */
  getActivityLogs(): Promise<ActivityLogEntry[]>;

  /** Fetch system diagnostics (platform, tools, skills). */
  getSystemDiagnostics(): Promise<SystemDiagnostics>;

  /** Fetch bundled skills installation status. */
  getBundledSkillsStatus(): Promise<BundledSkillsStatus>;
}

// ── Subscription interface ──────────────────────────────────

/**
 * Push-based event streams the renderer subscribes to.
 * Returns an `Unsubscribe` handle — caller is responsible for cleanup.
 *
 * Transport adapters map these to:
 *   - Electron IPC:  ipcRenderer.on / removeListener
 *   - WebSocket:     message frames filtered by channel
 *   - SSE:           EventSource listeners
 */
export interface UITransportSubscriptions {
  /** Real-time task state deltas (created / updated / removed). */
  onTaskDelta(cb: (delta: TaskDelta) => void): Unsubscribe;

  /** Streaming task output chunks. */
  onTaskOutput(cb: (data: TaskOutputData) => void): Unsubscribe;

  /** Activity log pushes. */
  onActivityLog(cb: (entries: ActivityLogEntry[]) => void): Unsubscribe;

  /** Workflow list changed (e.g. new workflow loaded, workflow deleted). */
  onWorkflowsChanged(cb: (workflows: WorkflowMeta[]) => void): Unsubscribe;
}

// ── Mutation interface ──────────────────────────────────────

/**
 * State-changing commands the renderer sends to the backend.
 * Mutations return a Promise that resolves when the backend acknowledges.
 * Void return means fire-and-acknowledge (no meaningful response payload).
 */
export interface UITransportMutations {
  // ── Plan & Workflow lifecycle ──────────────────────────────
  loadPlan(planText: string): Promise<void>;
  start(): Promise<TaskState[]>;
  stop(): Promise<void>;
  clear(): Promise<void>;
  resumeWorkflow(): Promise<ResumeWorkflowResult | null>;
  deleteWorkflow(workflowId: string): Promise<void>;
  deleteAllWorkflows(): Promise<void>;

  // ── Task actions ───────────────────────────────────────────
  approve(taskId: string): Promise<void>;
  reject(taskId: string, reason?: string): Promise<void>;
  provideInput(taskId: string, input: string): Promise<void>;
  selectExperiment(taskId: string, experimentId: string | string[]): Promise<void>;
  restartTask(taskId: string): Promise<void>;
  cancelTask(taskId: string): Promise<CancelResult>;
  cancelWorkflow(workflowId: string): Promise<CancelResult>;

  // ── Task editing ───────────────────────────────────────────
  editTaskCommand(taskId: string, newCommand: string): Promise<void>;
  editTaskType(taskId: string, executorType: string, remoteTargetId?: string): Promise<void>;
  editTaskAgent(taskId: string, agentName: string): Promise<void>;
  editTaskPrompt(taskId: string, newPrompt: string): Promise<void>;
  setTaskExternalGatePolicies(taskId: string, updates: ExternalGatePolicyUpdate[]): Promise<void>;
  replaceTask(taskId: string, replacementTasks: TaskReplacementDef[]): Promise<TaskState[]>;

  // ── Workflow mutation & merge ──────────────────────────────
  recreateWorkflow(workflowId: string): Promise<void>;
  recreateTask(taskId: string): Promise<void>;
  retryWorkflow(workflowId: string): Promise<void>;
  rebaseAndRetry(mergeTaskId: string): Promise<RebaseAndRetryResult>;
  recreateWithRebase(workflowId: string): Promise<RebaseAndRetryResult>;
  setMergeBranch(workflowId: string, baseBranch: string): Promise<void>;
  setMergeMode(workflowId: string, mergeMode: string): Promise<void>;
  approveMerge(workflowId: string): Promise<void>;

  // ── PR & conflict resolution ───────────────────────────────
  resolveConflict(taskId: string, agentName?: string): Promise<void>;
  fixWithAgent(taskId: string, agentName?: string): Promise<void>;

  // ── Maintenance ────────────────────────────────────────────
  cleanupWorktrees(): Promise<CleanupWorktreesResult>;
  installBundledSkills(mode?: BundledSkillsInstallMode): Promise<BundledSkillsStatus>;
}

// ── Composite transport interface ───────────────────────────

/**
 * Full UI transport surface combining queries, subscriptions, and mutations.
 *
 * Adapters implement this interface. The renderer programs against it
 * rather than against `window.invoker` directly, enabling transport
 * substitution without changing hook logic.
 *
 * Lifecycle:
 *   - `connect()` establishes the transport (WebSocket handshake, IPC ready check).
 *   - `disconnect()` tears down connections and unsubscribes all listeners.
 *   - `isConnected()` reports current connectivity.
 *
 * Error reporting:
 *   - `onError()` receives transport-level errors (connection lost, decode failure).
 *     Application-level errors (task failed) flow through query/mutation rejections.
 */
export interface UITransport extends UITransportQueries, UITransportSubscriptions, UITransportMutations {
  /** Establish the transport connection. Resolves when ready to accept calls. */
  connect(): Promise<void>;

  /** Tear down the transport. After this call, all methods reject. */
  disconnect(): Promise<void>;

  /** Whether the transport is currently connected and accepting calls. */
  isConnected(): boolean;

  /** Subscribe to transport-level errors (connection lost, protocol errors). */
  onError(cb: (error: UITransportError) => void): Unsubscribe;
}

// ── Transport error ─────────────────────────────────────────

/**
 * Structured error for transport-level failures.
 * Application errors (e.g. "task not found") are returned via
 * Promise rejection from individual methods.
 */
export interface UITransportError {
  /** Machine-readable error code. */
  readonly code: UITransportErrorCode;
  /** Human-readable description. */
  readonly message: string;
  /** Whether the transport will attempt automatic reconnection. */
  readonly retriable: boolean;
}

export type UITransportErrorCode =
  | 'CONNECTION_LOST'
  | 'CONNECTION_REFUSED'
  | 'PROTOCOL_ERROR'
  | 'TIMEOUT'
  | 'UNAUTHORIZED';
