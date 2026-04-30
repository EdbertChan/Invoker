/**
 * SqliteTaskRepository — Adapter that implements the TaskRepository port
 * by delegating to a PersistenceAdapter.
 *
 * Accepts the seam (PersistenceAdapter) rather than SQLiteAdapter so
 * decorators that wrap the adapter (logging, metrics) flow through the
 * repository without code changes.
 */

import type {
  TaskRepository,
  WorkflowRecord,
  WorkflowChanges,
  AttemptChanges,
  AttemptFailPatch,
} from '@invoker/workflow-core';
import type { TaskState, TaskStateChanges, Attempt } from '@invoker/workflow-core';
import type { PersistenceAdapter } from './adapter.js';

export class SqliteTaskRepository implements TaskRepository {
  constructor(private adapter: PersistenceAdapter) {}

  runInTransaction<T>(work: () => T): T {
    return this.adapter.runInTransaction(work);
  }

  // ── Workflow writes ──

  saveWorkflow(workflow: WorkflowRecord): void {
    this.adapter.saveWorkflow(workflow);
  }

  updateWorkflow(workflowId: string, changes: WorkflowChanges): void {
    this.adapter.updateWorkflow(workflowId, changes);
  }

  deleteWorkflow(workflowId: string): void {
    this.adapter.deleteWorkflow(workflowId);
  }

  deleteAllWorkflows(): void {
    this.adapter.deleteAllWorkflows();
  }

  // ── Task writes ──

  saveTask(workflowId: string, task: TaskState): void {
    this.adapter.saveTask(workflowId, task);
  }

  updateTask(taskId: string, changes: TaskStateChanges): void {
    this.adapter.updateTask(taskId, changes);
  }

  logEvent(taskId: string, eventType: string, payload?: unknown): void {
    this.adapter.logEvent(taskId, eventType, payload);
  }

  // ── Attempt writes ──

  saveAttempt(attempt: Attempt): void {
    this.adapter.saveAttempt(attempt);
  }

  updateAttempt(attemptId: string, changes: AttemptChanges): void {
    this.adapter.updateAttempt(attemptId, changes);
  }

  failTaskAndAttempt(
    taskId: string,
    taskChanges: TaskStateChanges,
    attemptPatch: AttemptFailPatch,
  ): void {
    this.adapter.failTaskAndAttempt(taskId, taskChanges, attemptPatch);
  }
}
