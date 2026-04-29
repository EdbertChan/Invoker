/**
 * InstrumentedPersistenceAdapter — A PersistenceAdapter decorator that
 * records timing and outcome metadata for the read/write methods the
 * orchestrator hits on every workflow lifecycle event.
 *
 * The wrapper preserves all return values, throws, and call ordering of
 * the underlying adapter; the only side effect is the structured event
 * fed into the supplied instrumenter.
 */

import type { TaskState, TaskStateChanges, Attempt } from '@invoker/workflow-core';
import type {
  ActivityLogEntry,
  Conversation,
  ConversationMessage,
  OutputChunk,
  PersistenceAdapter,
  TaskEvent,
  Workflow,
  WorkflowMutationIntent,
  WorkflowMutationIntentStatus,
} from './adapter.js';

export const PERSISTENCE_INSTRUMENTATION_SCOPE_PREFIX = 'persistence';

export type PersistenceInstrumentedMethod =
  | 'listWorkflows'
  | 'loadWorkflow'
  | 'loadTasks'
  | 'saveTask'
  | 'updateTask'
  | 'deleteWorkflow'
  | 'deleteAllWorkflows';

export interface PersistenceInstrumentationEvent {
  readonly scope: `${typeof PERSISTENCE_INSTRUMENTATION_SCOPE_PREFIX}.${PersistenceInstrumentedMethod}`;
  readonly method: PersistenceInstrumentedMethod;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
}

export type PersistenceInstrumenter = (event: PersistenceInstrumentationEvent) => void;

export interface InstrumentedPersistenceAdapterOptions {
  /** Override the wall clock (test seam). Defaults to Date.now. */
  readonly now?: () => number;
}

export class InstrumentedPersistenceAdapter implements PersistenceAdapter {
  private readonly inner: PersistenceAdapter;
  private readonly emit: PersistenceInstrumenter;
  private readonly now: () => number;

  constructor(
    inner: PersistenceAdapter,
    emit: PersistenceInstrumenter,
    options: InstrumentedPersistenceAdapterOptions = {},
  ) {
    this.inner = inner;
    this.emit = emit;
    this.now = options.now ?? (() => Date.now());
  }

  // ── Instrumentation core ───────────────────────────────────

  private record<T>(method: PersistenceInstrumentedMethod, fn: () => T): T {
    const start = this.now();
    try {
      const result = fn();
      this.emitEvent(method, start, true);
      return result;
    } catch (err) {
      this.emitEvent(method, start, false, err);
      throw err;
    }
  }

  private emitEvent(
    method: PersistenceInstrumentedMethod,
    start: number,
    success: boolean,
    err?: unknown,
  ): void {
    const event: PersistenceInstrumentationEvent = {
      scope: `${PERSISTENCE_INSTRUMENTATION_SCOPE_PREFIX}.${method}`,
      method,
      durationMs: this.now() - start,
      success,
      ...(success ? {} : { error: err instanceof Error ? err.message : String(err) }),
    };
    this.emit(event);
  }

  // ── Instrumented methods ───────────────────────────────────

  listWorkflows(): Workflow[] {
    return this.record('listWorkflows', () => this.inner.listWorkflows());
  }

  loadWorkflow(workflowId: string): Workflow | undefined {
    return this.record('loadWorkflow', () => this.inner.loadWorkflow(workflowId));
  }

  loadTasks(workflowId: string): TaskState[] {
    return this.record('loadTasks', () => this.inner.loadTasks(workflowId));
  }

  saveTask(workflowId: string, task: TaskState): void {
    this.record('saveTask', () => this.inner.saveTask(workflowId, task));
  }

  updateTask(taskId: string, changes: TaskStateChanges): void {
    this.record('updateTask', () => this.inner.updateTask(taskId, changes));
  }

  deleteWorkflow(workflowId: string): void {
    this.record('deleteWorkflow', () => this.inner.deleteWorkflow(workflowId));
  }

  deleteAllWorkflows(): void {
    this.record('deleteAllWorkflows', () => this.inner.deleteAllWorkflows());
  }

  // ── Pass-through methods ───────────────────────────────────

  saveWorkflow(workflow: Workflow): void {
    this.inner.saveWorkflow(workflow);
  }

  updateWorkflow(
    workflowId: string,
    changes: Parameters<PersistenceAdapter['updateWorkflow']>[1],
  ): void {
    this.inner.updateWorkflow(workflowId, changes);
  }

  getAllTaskIds(): string[] {
    return this.inner.getAllTaskIds();
  }

  getAllTaskBranches(): string[] {
    return this.inner.getAllTaskBranches();
  }

  deleteAllTasks(workflowId: string): void {
    this.inner.deleteAllTasks(workflowId);
  }

  logEvent(taskId: string, eventType: string, payload?: unknown): void {
    this.inner.logEvent(taskId, eventType, payload);
  }

  getEvents(taskId: string): TaskEvent[] {
    return this.inner.getEvents(taskId);
  }

  saveConversation(conversation: Conversation): void {
    this.inner.saveConversation(conversation);
  }

  loadConversation(threadTs: string): Conversation | undefined {
    return this.inner.loadConversation(threadTs);
  }

  updateConversation(
    threadTs: string,
    changes: Parameters<PersistenceAdapter['updateConversation']>[1],
  ): void {
    this.inner.updateConversation(threadTs, changes);
  }

  deleteConversation(threadTs: string): void {
    this.inner.deleteConversation(threadTs);
  }

  listActiveConversations(): Conversation[] {
    return this.inner.listActiveConversations();
  }

  deleteConversationsOlderThan(cutoffIso: string): number {
    return this.inner.deleteConversationsOlderThan(cutoffIso);
  }

  appendMessage(threadTs: string, role: 'user' | 'assistant', content: string): void {
    this.inner.appendMessage(threadTs, role, content);
  }

  loadMessages(threadTs: string): ConversationMessage[] {
    return this.inner.loadMessages(threadTs);
  }

  appendTaskOutput(taskId: string, data: string): void {
    this.inner.appendTaskOutput(taskId, data);
  }

  getTaskOutput(taskId: string): string {
    return this.inner.getTaskOutput(taskId);
  }

  saveAttempt(attempt: Attempt): void {
    this.inner.saveAttempt(attempt);
  }

  loadAttempts(nodeId: string): Attempt[] {
    return this.inner.loadAttempts(nodeId);
  }

  loadAttempt(attemptId: string): Attempt | undefined {
    return this.inner.loadAttempt(attemptId);
  }

  updateAttempt(
    attemptId: string,
    changes: Parameters<PersistenceAdapter['updateAttempt']>[1],
  ): void {
    this.inner.updateAttempt(attemptId, changes);
  }

  failTaskAndAttempt(
    taskId: string,
    taskChanges: TaskStateChanges,
    attemptPatch: Parameters<PersistenceAdapter['failTaskAndAttempt']>[2],
  ): void {
    this.inner.failTaskAndAttempt(taskId, taskChanges, attemptPatch);
  }

  getExecutionAgent(taskId: string): string | null {
    return this.inner.getExecutionAgent ? this.inner.getExecutionAgent(taskId) : null;
  }

  appendOutputChunk(taskId: string, data: string): void {
    this.inner.appendOutputChunk(taskId, data);
  }

  getOutputChunks(taskId: string): OutputChunk[] {
    return this.inner.getOutputChunks(taskId);
  }

  replayOutputFrom(taskId: string, fromOffset: number): OutputChunk[] {
    return this.inner.replayOutputFrom(taskId, fromOffset);
  }

  getOutputTail(taskId: string): OutputChunk[] {
    return this.inner.getOutputTail(taskId);
  }

  writeActivityLog(source: string, level: string, message: string): void {
    this.inner.writeActivityLog(source, level, message);
  }

  getActivityLogs(sinceId?: number, limit?: number): ActivityLogEntry[] {
    return this.inner.getActivityLogs(sinceId, limit);
  }

  loadAllCompletedTasks(): Array<TaskState & { workflowName: string }> {
    return this.inner.loadAllCompletedTasks();
  }

  listWorkflowMutationIntents(
    workflowId?: string,
    statuses?: WorkflowMutationIntentStatus[],
  ): WorkflowMutationIntent[] {
    return this.inner.listWorkflowMutationIntents(workflowId, statuses);
  }

  runInTransaction<T>(work: () => T): T {
    return this.inner.runInTransaction(work);
  }

  close(): void {
    this.inner.close();
  }
}
