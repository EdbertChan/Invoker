import type { Logger } from '@invoker/contracts';
import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import { publishTaskDelta, type TaskDeltaMessageBus } from './events.js';

function isActiveForExperimentInvalidation(status: TaskState['status']): boolean {
  return (
    status === 'running' ||
    status === 'fixing_with_ai' ||
    status === 'awaiting_approval' ||
    status === 'review_ready'
  );
}

function canonicalizeExperimentIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function sameExperimentSet(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (a === undefined) return false;
  const left = canonicalizeExperimentIds(a);
  const right = canonicalizeExperimentIds(b);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export interface MergeExperimentHost {
  readonly logger: Logger;
  readonly persistence: {
    logEvent?(taskId: string, eventType: string, payload?: unknown): void;
  };
  readonly messageBus: TaskDeltaMessageBus;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  updateSelectedAttempt(
    taskId: string,
    changes: {
      status?: 'completed' | 'superseded' | 'failed' | 'needs_input' | 'pending' | 'claimed' | 'running';
      completedAt?: Date;
      branch?: string;
      commit?: string;
    },
  ): void;
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  recreateTask(taskId: string): TaskState[];
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  findNewlyReadyTasks(taskId: string): string[];
  checkWorkflowCompletion(): void;
}

function previousExperimentSet(task: TaskState): readonly string[] | undefined {
  return task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
}

function cancelActiveDownstream(host: MergeExperimentHost, reconId: string, allTasksBefore: TaskState[]): void {
  const taskMapBefore = new Map(allTasksBefore.map((task) => [task.id, task]));
  const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
  for (const downstreamId of downstreamIds) {
    const downstream = host.stateGetTask(downstreamId);
    if (!downstream) continue;
    if (isActiveForExperimentInvalidation(downstream.status)) {
      host.cancelTask(downstreamId);
    }
  }
}

function resetDirectDownstream(host: MergeExperimentHost, reconId: string, allTasksBefore: TaskState[]): void {
  const directDownstream = allTasksBefore
    .filter((task) => task.dependencies.includes(reconId))
    .map((task) => task.id);
  for (const downstreamId of directDownstream) {
    if (host.stateGetTask(downstreamId)) {
      host.recreateTask(downstreamId);
    }
  }
}

export function selectExperimentDomain(
  host: MergeExperimentHost,
  taskId: string,
  experimentId: string,
): TaskState[] {
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const winner = host.stateGetTask(experimentId);
  const winnerId = winner?.id ?? experimentId;
  const previousSet = previousExperimentSet(task);
  const isReSelection = previousSet !== undefined && !sameExperimentSet(previousSet, [winnerId]);
  const allTasksBefore = host.getAllTasks();

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
  const reconUpdated = host.writeAndSync(reconId, changes);
  host.updateSelectedAttempt(reconId, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: winner?.execution.branch,
    commit: winner?.execution.commit,
  });
  const delta = host.buildUpdateDelta(task, reconUpdated, changes);
  host.persistence.logEvent?.(reconId, 'task.completed', changes);
  publishTaskDelta(host.messageBus, delta);

  if (isReSelection) {
    resetDirectDownstream(host, reconId, allTasksBefore);
  }

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

export function selectExperimentsDomain(
  host: MergeExperimentHost,
  taskId: string,
  experimentIds: string[],
  combinedBranch?: string,
  combinedCommit?: string,
): TaskState[] {
  if (experimentIds.length === 1) {
    return selectExperimentDomain(host, taskId, experimentIds[0]);
  }

  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const previousSet = previousExperimentSet(task);
  const isReSelection = previousSet !== undefined && !sameExperimentSet(previousSet, experimentIds);
  const allTasksBefore = host.getAllTasks();

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
  const reconUpdated = host.writeAndSync(reconId, changes);
  host.updateSelectedAttempt(reconId, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: combinedBranch,
    commit: combinedCommit,
  });
  const delta = host.buildUpdateDelta(task, reconUpdated, changes);
  host.persistence.logEvent?.(reconId, 'task.completed', changes);
  publishTaskDelta(host.messageBus, delta);

  if (isReSelection) {
    resetDirectDownstream(host, reconId, host.getAllTasks());
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

export function checkExperimentCompletionDomain(
  host: MergeExperimentHost,
  taskId: string,
): void {
  for (const recon of host.getAllTasks()) {
    if (!recon.config.isReconciliation) continue;
    if (
      recon.status === 'needs_input' ||
      recon.status === 'completed' ||
      recon.status === 'running' ||
      recon.status === 'fixing_with_ai'
    ) {
      continue;
    }
    if (!recon.dependencies.includes(taskId)) continue;

    const allReported = recon.dependencies.every((depId) => {
      const dep = host.stateGetTask(depId);
      return dep && (dep.status === 'completed' || dep.status === 'failed');
    });

    if (!allReported) continue;

    const experimentResults = recon.dependencies.map((depId) => {
      const dep = host.stateGetTask(depId)!;
      return {
        id: depId,
        status: (dep.status === 'completed' ? 'completed' : 'failed') as 'completed' | 'failed',
        summary: dep.config.summary,
        exitCode: dep.execution.exitCode,
      };
    });

    const reconChanges: TaskStateChanges = {
      execution: { experimentResults },
    };
    const reconUpdated = host.writeAndSync(recon.id, reconChanges);
    const delta = host.buildUpdateDelta(recon, reconUpdated, reconChanges);
    host.persistence.logEvent?.(recon.id, 'task.experiment_results_recorded', reconChanges);
    publishTaskDelta(host.messageBus, delta);
  }
}
