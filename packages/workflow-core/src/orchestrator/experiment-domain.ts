import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges, TaskStatus } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import type { OrchestratorPersistence } from '../orchestrator.js';
import { publishTaskDelta, type TaskDeltaMessageBus } from './events-domain.js';

function isActiveForExperimentInvalidation(status: TaskStatus): boolean {
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

function isReselection(task: TaskState, nextIds: readonly string[]): boolean {
  const previousSet = task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
  if (previousSet === undefined) return false;

  const newCanon = canonicalize(nextIds);
  const prevCanon = canonicalize(previousSet);
  const sameAsPrev =
    prevCanon.length === newCanon.length &&
    prevCanon.every((id, i) => id === newCanon[i]);
  return !sameAsPrev;
}

export interface ExperimentDomainHost {
  readonly stateMachine: {
    getAllTasks(): TaskState[];
    findNewlyReadyTasks(taskId: string): string[];
  };
  readonly persistence: OrchestratorPersistence;
  readonly messageBus: TaskDeltaMessageBus;
  readonly logger: Logger;

  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  updateSelectedAttempt(
    taskId: string,
    changes: Partial<Pick<Attempt, 'status' | 'completedAt' | 'branch' | 'commit'>>,
  ): void;
  cancelTask(taskId: string): void;
  recreateTask(taskId: string): TaskState[];
  autoStartReadyTasks(taskIds: string[]): TaskState[];
  checkWorkflowCompletion(): void;
}

function cancelActiveDownstreamBeforeReselection(
  host: ExperimentDomainHost,
  reconId: string,
  allTasksBefore: TaskState[],
): void {
  const taskMapBefore = new Map(allTasksBefore.map((task) => [task.id, task]));
  const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
  for (const downstreamId of downstreamIds) {
    const downstreamTask = host.stateGetTask(downstreamId);
    if (!downstreamTask) continue;
    if (isActiveForExperimentInvalidation(downstreamTask.status)) {
      host.cancelTask(downstreamId);
    }
  }
}

function finishExperimentSelection(
  host: ExperimentDomainHost,
  task: TaskState,
  changes: TaskStateChanges,
  allTasksBefore: TaskState[],
  isReSelection: boolean,
  logLabel: string,
): TaskState[] {
  const reconId = task.id;
  const reconUpdated = host.writeAndSync(reconId, changes);
  host.updateSelectedAttempt(reconId, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: changes.execution?.branch,
    commit: changes.execution?.commit,
  });
  host.persistence.logEvent?.(reconId, 'task.completed', changes);
  publishTaskDelta(
    host.messageBus,
    host.buildUpdateDelta(task, reconUpdated, changes),
  );

  if (isReSelection) {
    const directDownstream = allTasksBefore
      .filter((candidate) => candidate.dependencies.includes(reconId))
      .map((candidate) => candidate.id);
    for (const downstreamId of directDownstream) {
      if (host.stateGetTask(downstreamId)) {
        host.recreateTask(downstreamId);
      }
    }
  }

  const readyTaskIds = host.stateMachine.findNewlyReadyTasks(reconId);
  host.logger.info(logLabel, {
    taskId: reconId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  host.checkWorkflowCompletion();
  return started;
}

export function selectExperiment(
  host: ExperimentDomainHost,
  taskId: string,
  experimentId: string,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];

  const winner = host.stateGetTask(experimentId);
  const winnerId = winner?.id ?? experimentId;
  const isReSelection = isReselection(task, [winnerId]);
  const allTasksBefore = host.stateMachine.getAllTasks();
  if (isReSelection) {
    cancelActiveDownstreamBeforeReselection(host, task.id, allTasksBefore);
  }

  return finishExperimentSelection(
    host,
    task,
    {
      status: 'completed',
      execution: {
        selectedExperiment: winnerId,
        completedAt: new Date(),
        branch: winner?.execution.branch,
        commit: winner?.execution.commit,
      },
    },
    allTasksBefore,
    isReSelection,
    '[orchestrator] selectExperiment',
  );
}

export function selectExperiments(
  host: ExperimentDomainHost,
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

  const isReSelection = isReselection(task, experimentIds);
  const allTasksBefore = host.stateMachine.getAllTasks();
  if (isReSelection) {
    cancelActiveDownstreamBeforeReselection(host, task.id, allTasksBefore);
  }

  return finishExperimentSelection(
    host,
    task,
    {
      status: 'completed',
      execution: {
        selectedExperiment: experimentIds[0],
        selectedExperiments: experimentIds,
        completedAt: new Date(),
        branch: combinedBranch,
        commit: combinedCommit,
      },
    },
    allTasksBefore,
    isReSelection,
    '[orchestrator] selectExperiments',
  );
}
