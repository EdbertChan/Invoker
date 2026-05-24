import type { Logger } from '@invoker/contracts';
import type { TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import { publishTaskUpdate, type TaskDeltaEventHost } from './events.js';

export interface ExperimentDomainHost extends TaskDeltaEventHost {
  logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  findNewlyReadyTasks(taskId: string): string[];
  isActiveForInvalidationStatus(status: TaskState['status']): boolean;
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(
    taskId: string,
    changes: {
      status?: 'pending' | 'claimed' | 'running' | 'needs_input' | 'completed' | 'failed' | 'superseded';
      completedAt?: Date;
      branch?: string;
      commit?: string;
    },
  ): void;
  recreateTask(taskId: string): TaskState[];
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  checkWorkflowCompletion(): void;
}

function canonicalizeExperimentIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function getPreviousSelection(task: TaskState): readonly string[] | undefined {
  return task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
}

function isReselection(previousSet: readonly string[] | undefined, nextSet: readonly string[]): boolean {
  if (previousSet === undefined) return false;
  const prevCanon = canonicalizeExperimentIds(previousSet);
  const nextCanon = canonicalizeExperimentIds(nextSet);
  return prevCanon.length !== nextCanon.length || prevCanon.some((id, i) => id !== nextCanon[i]);
}

function cancelActiveDownstream(host: ExperimentDomainHost, reconId: string, allTasksBefore: TaskState[]): void {
  const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
  const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
  for (const dsId of downstreamIds) {
    const dt = host.stateGetTask(dsId);
    if (dt && host.isActiveForInvalidationStatus(dt.status)) {
      host.cancelTask(dsId);
    }
  }
}

function completeReconciliation(
  host: ExperimentDomainHost,
  task: TaskState,
  changes: TaskStateChanges,
): void {
  const reconUpdated = host.writeAndSync(task.id, changes);
  host.updateSelectedAttempt(task.id, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: changes.execution?.branch,
    commit: changes.execution?.commit,
  });
  publishTaskUpdate(host, task, reconUpdated, changes, 'task.completed');
}

function finishExperimentSelection(host: ExperimentDomainHost, reconId: string): TaskState[] {
  const readyTaskIds = host.findNewlyReadyTasks(reconId);
  host.logger.info('[orchestrator] selectExperiment', {
    taskId: reconId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  host.checkWorkflowCompletion();
  return started;
}

export function selectExperimentImpl(
  host: ExperimentDomainHost,
  taskId: string,
  experimentId: string,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const winner = host.stateGetTask(experimentId);
  const winnerId = winner?.id ?? experimentId;
  const previousSet = getPreviousSelection(task);
  const reselecting = isReselection(previousSet, [winnerId]);
  const allTasksBefore = host.getAllTasks();

  if (reselecting) {
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
  completeReconciliation(host, task, changes);

  if (reselecting) {
    const directDownstream = allTasksBefore
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    for (const dsId of directDownstream) {
      host.recreateTask(dsId);
    }
  }

  return finishExperimentSelection(host, reconId);
}

export function selectExperimentsImpl(
  host: ExperimentDomainHost,
  taskId: string,
  experimentIds: string[],
  combinedBranch?: string,
  combinedCommit?: string,
): TaskState[] {
  if (experimentIds.length === 1) {
    return selectExperimentImpl(host, taskId, experimentIds[0]);
  }

  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const previousSet = getPreviousSelection(task);
  const reselecting = isReselection(previousSet, experimentIds);
  const allTasksBefore = host.getAllTasks();

  if (reselecting) {
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
  completeReconciliation(host, task, changes);

  if (reselecting) {
    const directDownstreamAfter = host
      .getAllTasks()
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    for (const dsId of directDownstreamAfter) {
      if (host.stateGetTask(dsId)) {
        host.recreateTask(dsId);
      }
    }
  }

  const readyTaskIds = host.findNewlyReadyTasks(reconId);
  host.logger.info('[orchestrator] selectExperiments', {
    taskId: reconId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  host.checkWorkflowCompletion();
  return started;
}
