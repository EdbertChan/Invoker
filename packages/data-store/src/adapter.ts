/**
 * PersistenceAdapter — Interface for task/workflow storage.
 *
 * The core orchestrator depends on this interface, not on SQLite directly.
 * This allows swapping storage backends (in-memory, SQLite, etc.) and
 * wrapping the live store with decorators (logging, metrics, retries)
 * without touching call sites.
 */

import type { TaskState, TaskStateChanges, PlanDefinition, Attempt } from '@invoker/workflow-core';

// ── Output Spool Types ──────────────────────────────────────

export interface OutputChunk {
  offset: number;
  data: string;
}

// ── Workflow Mutation Intent Types ──────────────────────────

export type WorkflowMutationPriority = 'high' | 'normal';
export type WorkflowMutationIntentStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface WorkflowMutationIntent {
  id: number;
  workflowId: string;
  channel: string;
  args: unknown[];
  priority: WorkflowMutationPriority;
  status: WorkflowMutationIntentStatus;
  ownerId?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ── Conversation Types ─────────────────────────────────────

export interface Conversation {
  threadTs: string;
  channelId: string;
  userId: string;
  extractedPlan: string | null;   // JSON-serialized PlanDefinition
  planSubmitted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: number;
  threadTs: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;                // JSON-serialized MessageParam content
  createdAt: string;
}

// ── Workflow Types ──────────────────────────────────────────

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  visualProof?: boolean;
  status: 'running' | 'completed' | 'failed';
  planFile?: string;
  repoUrl?: string;
  branch?: string;
  onFinish?: 'none' | 'merge' | 'pull_request';
  baseBranch?: string;
  featureBranch?: string;
  mergeMode?: 'manual' | 'automatic' | 'external_review';
  reviewProvider?: string;
  generation?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: number;
  taskId: string;
  eventType: string;
  payload?: string;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: number;
  timestamp: string;
  source: string;
  level: string;
  message: string;
}

export interface PersistenceAdapter {
  // Workflows
  saveWorkflow(workflow: Workflow): void;
  updateWorkflow(workflowId: string, changes: Partial<Pick<Workflow, 'status' | 'updatedAt' | 'baseBranch' | 'generation' | 'mergeMode'>>): void;
  loadWorkflow(workflowId: string): Workflow | undefined;
  listWorkflows(): Workflow[];

  // Tasks
  saveTask(workflowId: string, task: TaskState): void;
  updateTask(taskId: string, changes: TaskStateChanges): void;
  loadTasks(workflowId: string): TaskState[];
  getAllTaskIds(): string[];
  getAllTaskBranches(): string[];
  deleteAllTasks(workflowId: string): void;
  deleteAllWorkflows(): void;
  deleteWorkflow(workflowId: string): void;

  // Events (audit trail)
  logEvent(taskId: string, eventType: string, payload?: unknown): void;
  getEvents(taskId: string): TaskEvent[];

  // Conversations (Slack thread-based)
  saveConversation(conversation: Conversation): void;
  loadConversation(threadTs: string): Conversation | undefined;
  updateConversation(threadTs: string, changes: Partial<Pick<Conversation, 'extractedPlan' | 'planSubmitted' | 'updatedAt'>>): void;
  deleteConversation(threadTs: string): void;

  // Conversation queries
  listActiveConversations(): Conversation[];
  deleteConversationsOlderThan(cutoffIso: string): number;

  // Conversation messages
  appendMessage(threadTs: string, role: 'user' | 'assistant', content: string): void;
  loadMessages(threadTs: string): ConversationMessage[];

  // Task output (stdout/stderr persistence)
  appendTaskOutput(taskId: string, data: string): void;
  getTaskOutput(taskId: string): string;

  // Attempts
  saveAttempt(attempt: Attempt): void;
  loadAttempts(nodeId: string): Attempt[];
  loadAttempt(attemptId: string): Attempt | undefined;
  updateAttempt(attemptId: string, changes: Partial<Pick<Attempt, 'status' | 'claimedAt' | 'startedAt' | 'completedAt' | 'exitCode' | 'error' | 'lastHeartbeatAt' | 'leaseExpiresAt' | 'branch' | 'commit' | 'summary' | 'queuePriority' | 'workspacePath' | 'agentSessionId' | 'containerId' | 'mergeConflict'>>): void;

  /**
   * Atomically update a task's state and fail its running attempt (if any).
   * Wraps both updates in a transaction to prevent partial writes.
   */
  failTaskAndAttempt(
    taskId: string,
    taskChanges: TaskStateChanges,
    attemptPatch: Partial<Pick<Attempt, 'status' | 'exitCode' | 'error' | 'completedAt'>>
  ): void;

  // Agent queries
  /** Read the configured execution agent name for a task (e.g. 'claude', 'codex'). */
  getExecutionAgent?(taskId: string): string | null;

  // Output spool (offset-addressed streaming buffer)
  appendOutputChunk(taskId: string, data: string): void;
  getOutputChunks(taskId: string): OutputChunk[];
  replayOutputFrom(taskId: string, fromOffset: number): OutputChunk[];
  getOutputTail(taskId: string): OutputChunk[];

  // Activity log (structured app-level audit trail)
  writeActivityLog(source: string, level: string, message: string): void;
  getActivityLogs(sinceId?: number, limit?: number): ActivityLogEntry[];

  // Aggregated task queries
  loadAllCompletedTasks(): Array<TaskState & { workflowName: string }>;

  // Workflow mutation intent queue (read access; write/claim primitives
  // remain on concrete adapters that own the queue subsystem).
  listWorkflowMutationIntents(
    workflowId?: string,
    statuses?: WorkflowMutationIntentStatus[],
  ): WorkflowMutationIntent[];

  /**
   * Execute a group of writes atomically when the backing store supports it.
   * Adapters without transactions may simply execute the callback inline.
   */
  runInTransaction<T>(work: () => T): T;

  // Lifecycle
  close(): void;
}
