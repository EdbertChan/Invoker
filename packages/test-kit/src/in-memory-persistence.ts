import { DISPATCH_LEASE_MS } from '@invoker/contracts';
import { computeWorkflowRollup } from '@invoker/workflow-core';
import type { TaskState, TaskStateChanges, OrchestratorPersistence, Attempt, ExternalDependency, ExternalDependencyChange } from '@invoker/workflow-core';

type TaskLaunchDispatchState = 'enqueued' | 'leased' | 'completed' | 'abandoned';
type TaskLaunchDispatchPriority = 'high' | 'normal' | 'low';

interface TaskLaunchDispatch {
  id: number;
  taskId: string;
  attemptId: string;
  workflowId: string;
  state: TaskLaunchDispatchState;
  priority: TaskLaunchDispatchPriority;
  dispatchOwner?: string;
  enqueuedAt: string;
  leasedAt?: string;
  completedAt?: string;
  fencedUntil?: string;
  attemptsCount: number;
  lastError?: string;
  generation: number;
}

/**
 * In-memory implementation of OrchestratorPersistence for testing.
 * Stores workflows and tasks in Maps — no SQLite, no disk I/O.
 */
export class InMemoryPersistence implements OrchestratorPersistence {
  workflows = new Map<string, {
    id: string; name: string; status: string;
    createdAt: string; updatedAt: string;
    onFinish?: string; baseBranch?: string; featureBranch?: string;
    mergeMode?: 'manual' | 'automatic' | 'external_review';
    externalDependencies?: ExternalDependency[];
    externalDependencyChanges?: ExternalDependencyChange[];
    generation?: number;
  }>();
  tasks = new Map<string, { workflowId: string; task: TaskState }>();
  private attempts = new Map<string, Attempt[]>();
  private launchDispatches = new Map<number, TaskLaunchDispatch>();
  private nextLaunchDispatchId = 1;

  saveWorkflow(workflow: {
    id: string; name: string; status: string;
    createdAt?: string; updatedAt?: string;
    onFinish?: string; baseBranch?: string; featureBranch?: string;
    mergeMode?: 'manual' | 'automatic' | 'external_review';
    externalDependencies?: ExternalDependency[];
    externalDependencyChanges?: ExternalDependencyChange[];
    generation?: number;
  }): void {
    const now = new Date().toISOString();
    this.workflows.set(workflow.id, {
      ...workflow,
      createdAt: workflow.createdAt ?? now,
      updatedAt: workflow.updatedAt ?? now,
    });
  }

  updateWorkflow(workflowId: string, changes: { updatedAt?: string; baseBranch?: string; generation?: number; mergeMode?: 'manual' | 'automatic' | 'external_review'; externalDependencies?: ExternalDependency[]; externalDependencyChanges?: ExternalDependencyChange[] }): void {
    const wf = this.workflows.get(workflowId);
    if (wf) {
      if (changes.updatedAt) wf.updatedAt = changes.updatedAt;
      if (changes.baseBranch !== undefined) wf.baseBranch = changes.baseBranch;
      if (changes.generation !== undefined) wf.generation = changes.generation;
      if (changes.mergeMode !== undefined) wf.mergeMode = changes.mergeMode;
      if ('externalDependencies' in changes) wf.externalDependencies = changes.externalDependencies;
      if ('externalDependencyChanges' in changes) wf.externalDependencyChanges = changes.externalDependencyChanges;
    }
  }

  saveTask(workflowId: string, task: TaskState): void {
    this.tasks.set(task.id, { workflowId, task });
  }

  updateTask(taskId: string, changes: TaskStateChanges): void {
    let resolvedId = taskId;
    let entry = this.tasks.get(resolvedId);
    if (
      !entry &&
      !taskId.includes('/') &&
      !taskId.startsWith('__merge__') &&
      !taskId.endsWith('-reconciliation')
    ) {
      const suffix = `/${taskId}`;
      const matches: string[] = [];
      for (const id of this.tasks.keys()) {
        if (id === taskId || id.endsWith(suffix)) {
          matches.push(id);
        }
      }
      if (matches.length === 1) {
        resolvedId = matches[0]!;
        entry = this.tasks.get(resolvedId);
      }
    }
    if (entry) {
      if (
        changes.execution &&
        'workspacePath' in changes.execution &&
        entry.task.config.isMergeNode
      ) {
        const prev = entry.task.execution.workspacePath ?? null;
        const next = changes.execution.workspacePath ?? null;
        console.log(
          `[merge-gate-workspace] inMemory.updateTask mergeNode task=${taskId} ` +
            `workspacePath ${prev ?? 'NULL'} → ${next ?? 'NULL'}`,
        );
      }
      entry.task = {
        ...entry.task,
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.dependencies !== undefined ? { dependencies: changes.dependencies } : {}),
        config: { ...entry.task.config, ...changes.config },
        execution: { ...entry.task.execution, ...changes.execution },
        taskStateVersion: (entry.task.taskStateVersion ?? 1) + 1,
      } as TaskState;
    }
  }

  listWorkflows(): Array<{ id: string; name: string; status: string; createdAt: string; updatedAt: string; baseBranch?: string; onFinish?: string; mergeMode?: 'manual' | 'automatic' | 'external_review'; generation?: number }> {
    return Array.from(this.workflows.values()).map((workflow) => this.withDerivedStatus(workflow));
  }

  loadTasks(workflowId: string): TaskState[] {
    return Array.from(this.tasks.values())
      .filter((e) => e.workflowId === workflowId)
      .map((e) => e.task);
  }

  loadWorkflow(workflowId: string) {
    const workflow = this.workflows.get(workflowId);
    return workflow ? this.withDerivedStatus(workflow) as any : undefined;
  }

  private withDerivedStatus<T extends { id: string; status: string }>(workflow: T): T {
    const tasks = this.loadTasks(workflow.id);
    const rollup = computeWorkflowRollup(tasks);
    return { ...workflow, status: rollup.status, rollup };
  }

  getWorkspacePath(taskId: string): string | null {
    const entry = this.tasks.get(taskId);
    return entry?.task.execution.workspacePath ?? null;
  }

  logEvent(): void {}

  enqueueLaunchDispatch(input: {
    taskId: string;
    attemptId: string;
    workflowId: string;
    priority?: TaskLaunchDispatchPriority;
    generation: number;
  }): TaskLaunchDispatch {
    const existing = Array.from(this.launchDispatches.values()).find(
      (row) =>
        row.attemptId === input.attemptId &&
        (row.state === 'enqueued' || row.state === 'leased'),
    );
    if (existing) return { ...existing };
    const row: TaskLaunchDispatch = {
      id: this.nextLaunchDispatchId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      workflowId: input.workflowId,
      state: 'enqueued',
      priority: input.priority ?? 'normal',
      enqueuedAt: new Date().toISOString(),
      attemptsCount: 0,
      generation: input.generation,
    };
    this.nextLaunchDispatchId += 1;
    this.launchDispatches.set(row.id, row);
    return { ...row };
  }

  loadLaunchDispatchById(id: number): TaskLaunchDispatch | undefined {
    const row = this.launchDispatches.get(id);
    return row ? { ...row } : undefined;
  }

  loadLaunchDispatchByAttempt(attemptId: string): TaskLaunchDispatch | undefined {
    const rows = Array.from(this.launchDispatches.values())
      .filter(
        (row) =>
          row.attemptId === attemptId &&
          (row.state === 'enqueued' || row.state === 'leased'),
      )
      .sort((a, b) => b.id - a.id);
    return rows[0] ? { ...rows[0] } : undefined;
  }

  listLaunchDispatchesByState(states: readonly TaskLaunchDispatchState[]): TaskLaunchDispatch[] {
    const wanted = new Set(states);
    return Array.from(this.launchDispatches.values())
      .filter((row) => wanted.has(row.state))
      .sort((a, b) => a.id - b.id)
      .map((row) => ({ ...row }));
  }

  claimLaunchDispatchAtomic(options: {
    ownerId: string;
    nowIso?: string;
  }): TaskLaunchDispatch | undefined {
    const now = options.nowIso ?? new Date().toISOString();
    const fencedUntil = new Date(new Date(now).getTime() + DISPATCH_LEASE_MS).toISOString();
    const candidates = Array.from(this.launchDispatches.values())
      .filter((row) => row.state === 'enqueued')
      .sort((a, b) => {
        const priorityRank: Record<TaskLaunchDispatchPriority, number> = { high: 0, normal: 1, low: 2 };
        return priorityRank[a.priority] - priorityRank[b.priority] || a.id - b.id;
      });
    for (const row of candidates) {
      const task = this.tasks.get(row.taskId)?.task;
      let staleReason: string | undefined;
      if (!task) {
        staleReason = `Launch dispatch ${row.id} is stale: task ${row.taskId} no longer exists`;
      } else if (task.status !== 'pending') {
        staleReason = `Launch dispatch ${row.id} is stale: task ${row.taskId} status is ${task.status}`;
      } else if (task.execution.selectedAttemptId !== row.attemptId) {
        staleReason =
          `Launch dispatch ${row.id} is stale: attempt ${row.attemptId} ` +
          `is not the selected attempt ${task.execution.selectedAttemptId ?? 'none'}`;
      } else if ((task.execution.generation ?? 0) !== row.generation) {
        staleReason =
          `Launch dispatch ${row.id} is stale: generation ${row.generation} ` +
          `does not match task generation ${task.execution.generation ?? 0}`;
      }
      if (staleReason) {
        this.launchDispatches.set(row.id, {
          ...row,
          state: 'abandoned',
          completedAt: now,
          lastError: staleReason,
          dispatchOwner: undefined,
          fencedUntil: undefined,
        });
        continue;
      }

      const leased: TaskLaunchDispatch = {
        ...row,
        state: 'leased',
        dispatchOwner: options.ownerId,
        leasedAt: now,
        fencedUntil,
        attemptsCount: row.attemptsCount + 1,
      };
      this.launchDispatches.set(row.id, leased);
      return { ...leased };
    }
    return undefined;
  }

  markLaunchDispatchCompleted(id: number, nowIso?: string): boolean {
    const row = this.launchDispatches.get(id);
    if (!row || row.state === 'completed' || row.state === 'abandoned') return false;
    this.launchDispatches.set(id, {
      ...row,
      state: 'completed',
      completedAt: nowIso ?? new Date().toISOString(),
    });
    return true;
  }

  markLaunchDispatchFailed(id: number, errorMessage: string): boolean {
    const row = this.launchDispatches.get(id);
    if (!row || row.state === 'completed' || row.state === 'abandoned') return false;
    this.launchDispatches.set(id, {
      ...row,
      state: 'enqueued',
      lastError: errorMessage,
      dispatchOwner: undefined,
      fencedUntil: undefined,
    });
    return true;
  }

  listAbandonableLaunchDispatchLeases(options: {
    nowIso?: string;
    maxAttempts: number;
  }): TaskLaunchDispatch[] {
    const now = new Date(options.nowIso ?? new Date().toISOString()).getTime();
    return Array.from(this.launchDispatches.values())
      .filter(
        (row) =>
          row.state === 'leased' &&
          row.fencedUntil !== undefined &&
          new Date(row.fencedUntil).getTime() < now &&
          row.attemptsCount >= options.maxAttempts,
      )
      .sort((a, b) => a.id - b.id)
      .map((row) => ({ ...row }));
  }

  markLaunchDispatchAbandoned(id: number, errorMessage: string, nowIso?: string): boolean {
    const row = this.launchDispatches.get(id);
    if (!row || row.state === 'completed' || row.state === 'abandoned') return false;
    this.launchDispatches.set(id, {
      ...row,
      state: 'abandoned',
      completedAt: nowIso ?? new Date().toISOString(),
      lastError: errorMessage,
      dispatchOwner: undefined,
      fencedUntil: undefined,
    });
    return true;
  }

  reapExpiredLaunchDispatchLeases(options: {
    nowIso?: string;
    maxAttempts?: number;
  } = {}): TaskLaunchDispatch[] {
    const now = new Date(options.nowIso ?? new Date().toISOString()).getTime();
    const maxAttempts = options.maxAttempts ?? Number.MAX_SAFE_INTEGER;
    const reaped: TaskLaunchDispatch[] = [];
    for (const row of this.launchDispatches.values()) {
      if (
        row.state !== 'leased' ||
        row.fencedUntil === undefined ||
        new Date(row.fencedUntil).getTime() >= now ||
        row.attemptsCount >= maxAttempts
      ) {
        continue;
      }
      const reset = {
        ...row,
        state: 'enqueued' as const,
        dispatchOwner: undefined,
        fencedUntil: undefined,
      };
      this.launchDispatches.set(row.id, reset);
      reaped.push({ ...reset });
    }
    return reaped;
  }

  listExecutionResourceLeasesByTask(): Array<{ resourceKey: string; holderId: string; resourceType: string }> {
    return [];
  }

  releaseExecutionResourceLease(): boolean {
    return false;
  }

  saveAttempt(attempt: Attempt): void {
    const list = this.attempts.get(attempt.nodeId) ?? [];
    list.push(attempt);
    this.attempts.set(attempt.nodeId, list);
  }

  loadAttempts(nodeId: string): Attempt[] {
    return this.attempts.get(nodeId) ?? [];
  }

  loadAttempt(attemptId: string): Attempt | undefined {
    for (const list of this.attempts.values()) {
      const found = list.find(a => a.id === attemptId);
      if (found) return found;
    }
    return undefined;
  }

  updateAttempt(attemptId: string, changes: Partial<Pick<Attempt, 'status' | 'startedAt' | 'completedAt' | 'exitCode' | 'error' | 'lastHeartbeatAt' | 'branch' | 'commit' | 'summary' | 'workspacePath' | 'agentSessionId' | 'containerId' | 'mergeConflict'>>): void {
    for (const list of this.attempts.values()) {
      const idx = list.findIndex(a => a.id === attemptId);
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...changes } as Attempt;
        return;
      }
    }
  }

  deleteWorkflow(workflowId: string): void {
    this.workflows.delete(workflowId);
    for (const [taskId, entry] of this.tasks) {
      if (entry.workflowId === workflowId) this.tasks.delete(taskId);
    }
  }

  deleteAllWorkflows(): void {
    this.workflows.clear();
    this.tasks.clear();
  }
}
