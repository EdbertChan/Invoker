import { getTransitiveDependents, type TaskDelta, type TaskState, type TaskStateChanges } from '@invoker/workflow-graph';
import type { Logger } from '@invoker/contracts';
import type { OrchestratorEventsDomain } from './events-domain.js';

export interface ExperimentDomainHost {
  readonly logger: Logger;
  readonly eventsDomain: OrchestratorEventsDomain;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  isActiveForInvalidation(status: TaskState['status']): boolean;
  cancelTask(taskId: string): void;
  recreateTask(taskId: string): TaskState[];
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(
    taskId: string,
    changes: {
      status?: 'completed';
      completedAt?: Date;
      branch?: string;
      commit?: string;
    },
  ): void;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  logEvent(taskId: string, eventName: string, changes: TaskStateChanges): void;
  findNewlyReadyTasks(taskId: string): string[];
  autoStartReadyTasks(taskIds: string[]): TaskState[];
  checkWorkflowCompletion(): void;
}

function canonicalize(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function selectionChanged(previousSet: readonly string[] | undefined, nextIds: readonly string[]): boolean {
  if (previousSet === undefined) return false;
  const prevCanon = canonicalize(previousSet);
  const nextCanon = canonicalize(nextIds);
  return prevCanon.length !== nextCanon.length || prevCanon.some((id, i) => id !== nextCanon[i]);
}

export class OrchestratorExperimentDomain {
  constructor(private readonly host: ExperimentDomainHost) {}

  selectExperiment(taskId: string, experimentId: string): TaskState[] {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task || !task.config.isReconciliation) return [];
    const reconId = task.id;

    const winner = this.host.stateGetTask(experimentId);
    const winnerId = winner?.id ?? experimentId;
    const previousSet = task.execution.selectedExperiments
      ?? (task.execution.selectedExperiment !== undefined
        ? [task.execution.selectedExperiment]
        : undefined);
    const isReSelection = selectionChanged(previousSet, [winnerId]);
    const allTasksBefore = this.host.getAllTasks();
    this.cancelActiveDownstreamOnReselection(reconId, allTasksBefore, isReSelection);

    const changes: TaskStateChanges = {
      status: 'completed',
      execution: {
        selectedExperiment: winnerId,
        completedAt: new Date(),
        branch: winner?.execution.branch,
        commit: winner?.execution.commit,
      },
    };
    const reconUpdated = this.host.writeAndSync(reconId, changes);
    this.host.updateSelectedAttempt(reconId, {
      status: 'completed',
      completedAt: changes.execution?.completedAt,
      branch: winner?.execution.branch,
      commit: winner?.execution.commit,
    });
    this.host.logEvent(reconId, 'task.completed', changes);
    this.host.eventsDomain.publishDelta(this.host.buildUpdateDelta(task, reconUpdated, changes));

    if (isReSelection) {
      const directDownstream = allTasksBefore
        .filter((t) => t.dependencies.includes(reconId))
        .map((t) => t.id);
      for (const dsId of directDownstream) {
        this.host.recreateTask(dsId);
      }
    }

    return this.startReadyAfterSelection(reconId, 'selectExperiment');
  }

  selectExperiments(
    taskId: string,
    experimentIds: string[],
    combinedBranch?: string,
    combinedCommit?: string,
  ): TaskState[] {
    if (experimentIds.length === 1) {
      return this.selectExperiment(taskId, experimentIds[0]);
    }

    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task || !task.config.isReconciliation) return [];
    const reconId = task.id;

    const previousSet = task.execution.selectedExperiments
      ?? (task.execution.selectedExperiment !== undefined
        ? [task.execution.selectedExperiment]
        : undefined);
    const isReSelection = selectionChanged(previousSet, experimentIds);
    const allTasksBefore = this.host.getAllTasks();
    this.cancelActiveDownstreamOnReselection(reconId, allTasksBefore, isReSelection);

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
    const reconUpdated = this.host.writeAndSync(reconId, changes);
    this.host.updateSelectedAttempt(reconId, {
      status: 'completed',
      completedAt: changes.execution?.completedAt,
      branch: combinedBranch,
      commit: combinedCommit,
    });
    this.host.logEvent(reconId, 'task.completed', changes);
    this.host.eventsDomain.publishDelta(this.host.buildUpdateDelta(task, reconUpdated, changes));

    if (isReSelection) {
      const directDownstreamAfter = this.host
        .getAllTasks()
        .filter((t) => t.dependencies.includes(reconId))
        .map((t) => t.id);
      for (const dsId of directDownstreamAfter) {
        if (this.host.stateGetTask(dsId)) {
          this.host.recreateTask(dsId);
        }
      }
    }

    return this.startReadyAfterSelection(reconId, 'selectExperiments');
  }

  private cancelActiveDownstreamOnReselection(
    reconId: string,
    allTasksBefore: TaskState[],
    isReSelection: boolean,
  ): void {
    if (!isReSelection) return;
    const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
    const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
    for (const dsId of downstreamIds) {
      const dt = this.host.stateGetTask(dsId);
      if (dt && this.host.isActiveForInvalidation(dt.status)) {
        this.host.cancelTask(dsId);
      }
    }
  }

  private startReadyAfterSelection(reconId: string, label: string): TaskState[] {
    const readyTaskIds = this.host.findNewlyReadyTasks(reconId);
    this.host.logger.info(`[orchestrator] ${label}`, {
      taskId: reconId,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = this.host.autoStartReadyTasks(readyTaskIds);
    this.host.checkWorkflowCompletion();
    return started;
  }
}
