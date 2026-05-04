/**
 * InstrumentedTaskRepository — A TaskRepository decorator that records
 * timing and outcome metadata for the writes the orchestrator performs
 * on each lifecycle transition.
 *
 * Only the methods listed in the port that overlap with the persistence
 * boundary the orchestrator instruments are wrapped: `saveTask`,
 * `updateTask`, `deleteWorkflow`, and `deleteAllWorkflows`. The rest of
 * the port surface (workflow inserts, attempt writes, transactional
 * helpers) passes straight through to keep behavior identical.
 */

import type { TaskState, TaskStateChanges, Attempt } from '@invoker/workflow-graph';
import type {
  AttemptChanges,
  AttemptFailPatch,
  TaskRepository,
  WorkflowChanges,
  WorkflowRecord,
} from './task-repository.js';

export const TASK_REPOSITORY_INSTRUMENTATION_SCOPE_PREFIX = 'task-repository';

export type TaskRepositoryInstrumentedMethod =
  | 'saveTask'
  | 'updateTask'
  | 'deleteWorkflow'
  | 'deleteAllWorkflows';

export interface TaskRepositoryInstrumentationEvent {
  readonly scope: `${typeof TASK_REPOSITORY_INSTRUMENTATION_SCOPE_PREFIX}.${TaskRepositoryInstrumentedMethod}`;
  readonly method: TaskRepositoryInstrumentedMethod;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
}

export type TaskRepositoryInstrumenter = (event: TaskRepositoryInstrumentationEvent) => void;

export interface InstrumentedTaskRepositoryOptions {
  /** Override the wall clock (test seam). Defaults to Date.now. */
  readonly now?: () => number;
}

export class InstrumentedTaskRepository implements TaskRepository {
  private readonly inner: TaskRepository;
  private readonly emit: TaskRepositoryInstrumenter;
  private readonly now: () => number;

  constructor(
    inner: TaskRepository,
    emit: TaskRepositoryInstrumenter,
    options: InstrumentedTaskRepositoryOptions = {},
  ) {
    this.inner = inner;
    this.emit = emit;
    this.now = options.now ?? (() => Date.now());
  }

  // ── Instrumentation core ───────────────────────────────────

  private record<T>(method: TaskRepositoryInstrumentedMethod, fn: () => T): T {
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
    method: TaskRepositoryInstrumentedMethod,
    start: number,
    success: boolean,
    err?: unknown,
  ): void {
    const event: TaskRepositoryInstrumentationEvent = {
      scope: `${TASK_REPOSITORY_INSTRUMENTATION_SCOPE_PREFIX}.${method}`,
      method,
      durationMs: this.now() - start,
      success,
      ...(success ? {} : { error: err instanceof Error ? err.message : String(err) }),
    };
    this.emit(event);
  }

  // ── Pass-through methods ───────────────────────────────────

  runInTransaction<T>(work: () => T): T {
    return this.inner.runInTransaction(work);
  }

  saveWorkflow(workflow: WorkflowRecord): void {
    this.inner.saveWorkflow(workflow);
  }

  updateWorkflow(workflowId: string, changes: WorkflowChanges): void {
    this.inner.updateWorkflow(workflowId, changes);
  }

  logEvent(taskId: string, eventType: string, payload?: unknown): void {
    this.inner.logEvent(taskId, eventType, payload);
  }

  saveAttempt(attempt: Attempt): void {
    this.inner.saveAttempt(attempt);
  }

  updateAttempt(attemptId: string, changes: AttemptChanges): void {
    this.inner.updateAttempt(attemptId, changes);
  }

  failTaskAndAttempt(
    taskId: string,
    taskChanges: TaskStateChanges,
    attemptPatch: AttemptFailPatch,
  ): void {
    this.inner.failTaskAndAttempt(taskId, taskChanges, attemptPatch);
  }

  // ── Instrumented methods ───────────────────────────────────

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
}
