import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges, TaskStatus } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';
import { publishTaskDelta } from './events.js';

type SelectedAttemptChanges = Partial<
  Pick<Attempt, 'status' | 'completedAt' | 'branch' | 'commit'>
>;

export interface OrchestratorExperimentHost {
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
  logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  findNewlyReadyTasks(taskId: string): string[];
  cancelTask(taskId: string): void;
  recreateTask(taskId: string): TaskState[];
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(taskId: string, changes: SelectedAttemptChanges): void;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  autoStartReadyTasks(taskIds: string[]): TaskState[];
  checkWorkflowCompletion(): void;
}

function isActiveForInvalidation(status: TaskStatus): boolean {
  return (
    status === 'running' ||
    status === 'fixing_with_ai' ||
    status === 'awaiting_approval' ||
    status === 'review_ready'
  );
}

function canonicalize(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function previousExperimentSet(task: TaskState): readonly string[] | undefined {
  return task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
}

function isReselection(task: TaskState, experimentIds: readonly string[]): boolean {
  const previousSet = previousExperimentSet(task);
  const newCanon = canonicalize(experimentIds);
  const prevCanon = previousSet ? canonicalize(previousSet) : undefined;
  const sameAsPrev =
    prevCanon !== undefined &&
    prevCanon.length === newCanon.length &&
    prevCanon.every((id, i) => id === newCanon[i]);
  return previousSet !== undefined && !sameAsPrev;
}

function cancelActiveDownstream(host: OrchestratorExperimentHost, reconId: string, tasksBefore: TaskState[]): void {
  const taskMapBefore = new Map(tasksBefore.map((t) => [t.id, t]));
  const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
  for (const dsId of downstreamIds) {
    const dt = host.stateGetTask(dsId);
    if (!dt || !isActiveForInvalidation(dt.status)) continue;
    host.cancelTask(dsId);
  }
}

function completeReconciliation(
  host: OrchestratorExperimentHost,
  task: TaskState,
  changes: TaskStateChanges,
  attemptChanges: SelectedAttemptChanges,
): void {
  const updated = host.writeAndSync(task.id, changes);
  host.updateSelectedAttempt(task.id, attemptChanges);
  const delta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(task.id, 'task.completed', changes);
  publishTaskDelta(host.messageBus, delta);
}

function finishSelection(
  host: OrchestratorExperimentHost,
  reconId: string,
  logLabel: 'selectExperiment' | 'selectExperiments',
): TaskState[] {
  const readyTaskIds = host.findNewlyReadyTasks(reconId);
  host.logger.info(`[orchestrator] ${logLabel}`, {
    taskId: reconId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  host.checkWorkflowCompletion();
  return started;
}

export function selectExperiment(
  host: OrchestratorExperimentHost,
  taskId: string,
  experimentId: string,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const winner = host.stateGetTask(experimentId);
  const winnerId = winner?.id ?? experimentId;
  const allTasksBefore = host.getAllTasks();
  const isReSelection = isReselection(task, [winnerId]);
  if (isReSelection) {
    cancelActiveDownstream(host, reconId, allTasksBefore);
  }

  const changes: TaskStateChanges = {
    status: 'completed',
    execution: {
      selectedExperiment: winnerId,
      completedAt: new Date(),
      branch: winner?.execution.branch,
      commit: winner?.execution.commit,
    },
  };
  completeReconciliation(host, task, changes, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: winner?.execution.branch,
    commit: winner?.execution.commit,
  });

  if (isReSelection) {
    const directDownstream = allTasksBefore
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    for (const dsId of directDownstream) {
      host.recreateTask(dsId);
    }
  }

  return finishSelection(host, reconId, 'selectExperiment');
}

export function selectExperiments(
  host: OrchestratorExperimentHost,
  taskId: string,
  experimentIds: string[],
  combinedBranch?: string,
  combinedCommit?: string,
): TaskState[] {
  if (experimentIds.length === 1) {
    return selectExperiment(host, taskId, experimentIds[0]);
  }

  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const allTasksBefore = host.getAllTasks();
  const isReSelection = isReselection(task, experimentIds);
  if (isReSelection) {
    cancelActiveDownstream(host, reconId, allTasksBefore);
  }

  const changes: TaskStateChanges = {
    status: 'completed',
    execution: {
      selectedExperiment: experimentIds[0],
      selectedExperiments: experimentIds,
      completedAt: new Date(),
      branch: combinedBranch,
      commit: combinedCommit,
    },
  };
  completeReconciliation(host, task, changes, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: combinedBranch,
    commit: combinedCommit,
  });

  if (isReSelection) {
    const directDownstreamAfter = host.getAllTasks()
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    for (const dsId of directDownstreamAfter) {
      if (host.stateGetTask(dsId)) {
        host.recreateTask(dsId);
      }
    }
  }

  return finishSelection(host, reconId, 'selectExperiments');
}
