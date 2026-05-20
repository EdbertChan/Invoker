import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import type { Logger } from '@invoker/contracts';
import type { ParsedResponse } from '../response-handler.js';

export interface OrchestratorExperimentsContext {
  logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(taskId: string, changes: {
    status?: 'completed';
    completedAt?: Date;
    branch?: string;
    commit?: string;
  }): void;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  logEvent(taskId: string, eventType: string, payload?: unknown): void;
  publishTaskDelta(delta: TaskDelta): void;
  isActiveForInvalidation(status: TaskState['status']): boolean;
  cancelTask(taskId: string): void;
  recreateTask(taskId: string): void;
  findNewlyReadyTasks(taskId: string): string[];
  autoStartReadyTasks(taskIds: string[]): TaskState[];
  checkWorkflowCompletion(): void;
}

function canonicalizeExperimentIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function selectedExperimentSet(task: TaskState): readonly string[] | undefined {
  return task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
}

function hasSelectionChanged(task: TaskState, experimentIds: readonly string[]): boolean {
  const previousSet = selectedExperimentSet(task);
  if (previousSet === undefined) return false;
  const prevCanon = canonicalizeExperimentIds(previousSet);
  const nextCanon = canonicalizeExperimentIds(experimentIds);
  return prevCanon.length !== nextCanon.length || !prevCanon.every((id, i) => id === nextCanon[i]);
}

export class OrchestratorExperimentsDomain {
  constructor(private readonly ctx: OrchestratorExperimentsContext) {}

  selectExperiment(taskId: string, experimentId: string): TaskState[] {
    this.ctx.refreshFromDb();
    const task = this.ctx.stateGetTask(taskId);
    if (!task || !task.config.isReconciliation) return [];
    const reconId = task.id;

    const winner = this.ctx.stateGetTask(experimentId);
    const winnerId = winner?.id ?? experimentId;
    const allTasksBefore = this.ctx.getAllTasks();
    const isReSelection = hasSelectionChanged(task, [winnerId]);
    this.cancelActiveDownstreamForReselection(reconId, allTasksBefore, isReSelection);

    const changes: TaskStateChanges = {
      status: 'completed',
      execution: {
        selectedExperiment: winnerId,
        completedAt: new Date(),
        branch: winner?.execution.branch,
        commit: winner?.execution.commit,
      },
    };
    const reconUpdated = this.ctx.writeAndSync(reconId, changes);
    this.ctx.updateSelectedAttempt(reconId, {
      status: 'completed',
      completedAt: changes.execution?.completedAt,
      branch: winner?.execution.branch,
      commit: winner?.execution.commit,
    });
    this.ctx.logEvent(reconId, 'task.completed', changes);
    this.ctx.publishTaskDelta(this.ctx.buildUpdateDelta(task, reconUpdated, changes));

    if (isReSelection) {
      for (const dsId of allTasksBefore.filter((t) => t.dependencies.includes(reconId)).map((t) => t.id)) {
        this.ctx.recreateTask(dsId);
      }
    }

    return this.startNewlyReadyAfterSelection(reconId, 'selectExperiment');
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

    this.ctx.refreshFromDb();
    const task = this.ctx.stateGetTask(taskId);
    if (!task || !task.config.isReconciliation) return [];
    const reconId = task.id;

    const allTasksBefore = this.ctx.getAllTasks();
    const isReSelection = hasSelectionChanged(task, experimentIds);
    this.cancelActiveDownstreamForReselection(reconId, allTasksBefore, isReSelection);

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
    const reconUpdated = this.ctx.writeAndSync(reconId, changes);
    this.ctx.updateSelectedAttempt(reconId, {
      status: 'completed',
      completedAt: changes.execution?.completedAt,
      branch: combinedBranch,
      commit: combinedCommit,
    });
    this.ctx.logEvent(reconId, 'task.completed', changes);
    this.ctx.publishTaskDelta(this.ctx.buildUpdateDelta(task, reconUpdated, changes));

    if (isReSelection) {
      const directDownstreamAfter = this.ctx.getAllTasks()
        .filter((t) => t.dependencies.includes(reconId))
        .map((t) => t.id);
      for (const dsId of directDownstreamAfter) {
        if (this.ctx.stateGetTask(dsId)) {
          this.ctx.recreateTask(dsId);
        }
      }
    }

    return this.startNewlyReadyAfterSelection(reconId, 'selectExperiments');
  }

  checkExperimentCompletion(taskId: string): void {
    for (const recon of this.ctx.getAllTasks()) {
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
        const dep = this.ctx.stateGetTask(depId);
        return dep && (dep.status === 'completed' || dep.status === 'failed');
      });
      if (!allReported) continue;

      const experimentResults = recon.dependencies.map((depId) => {
        const dep = this.ctx.stateGetTask(depId)!;
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
      const reconUpdated = this.ctx.writeAndSync(recon.id, reconChanges);
      this.ctx.logEvent(recon.id, 'task.experiment_results_recorded', reconChanges);
      this.ctx.publishTaskDelta(this.ctx.buildUpdateDelta(recon, reconUpdated, reconChanges));
    }
  }

  handleSelectExperiment(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'select_experiment' }>,
  ): TaskState[] {
    return this.selectExperiment(taskId, parsed.experimentId);
  }

  private cancelActiveDownstreamForReselection(
    reconId: string,
    allTasksBefore: TaskState[],
    isReSelection: boolean,
  ): void {
    if (!isReSelection) return;

    const taskMapBefore = new Map(allTasksBefore.map((task) => [task.id, task]));
    const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
    for (const dsId of downstreamIds) {
      const downstream = this.ctx.stateGetTask(dsId);
      if (downstream && this.ctx.isActiveForInvalidation(downstream.status)) {
        this.ctx.cancelTask(dsId);
      }
    }
  }

  private startNewlyReadyAfterSelection(reconId: string, label: string): TaskState[] {
    const readyTaskIds = this.ctx.findNewlyReadyTasks(reconId);
    this.ctx.logger.info(`[orchestrator] ${label}`, {
      taskId: reconId,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = this.ctx.autoStartReadyTasks(readyTaskIds);
    this.ctx.checkWorkflowCompletion();
    return started;
  }
}
