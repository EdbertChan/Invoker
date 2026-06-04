import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges, TaskStatus } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import {
  applyGraphMutationImpl,
  assertMergeExperimentDependenciesInvariantImpl,
  assertMergeLeavesInvariantImpl,
  reconcileMergeLeavesImpl,
  type GraphMutationHost,
} from '../graph-mutation.js';
import { MUTATION_POLICIES, type InvalidationAction } from '../invalidation-policy.js';
import type { GraphMutation, OrchestratorPersistence } from '../orchestrator.js';
import type { OrchestratorEventDomain } from './events.js';

type MergeMode = 'manual' | 'automatic' | 'external_review';

export interface OrchestratorMergeExperimentHost {
  stateMachine: GraphMutationHost['stateMachine'];
  persistence: OrchestratorPersistence;
  events: OrchestratorEventDomain;
  logger: Logger;

  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  createAndSync(task: TaskState): TaskState;
  updateSelectedAttempt(
    taskId: string,
    changes: Partial<Pick<Attempt, 'status' | 'completedAt' | 'branch' | 'commit'>>,
  ): void;
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  recreateTask(taskId: string): TaskState[];
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
  findNewlyReadyTasks(taskId: string): string[];
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  checkWorkflowCompletion(): void;
  isActiveForInvalidation(status: TaskStatus): boolean;
  createTaskNotFoundError(message: string): Error;
}

function canonicalizeExperimentSet(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function sameExperimentSet(left: readonly string[] | undefined, right: readonly string[]): boolean {
  if (!left) return false;
  const leftCanon = canonicalizeExperimentSet(left);
  const rightCanon = canonicalizeExperimentSet(right);
  return leftCanon.length === rightCanon.length && leftCanon.every((id, i) => id === rightCanon[i]);
}

export class OrchestratorMergeExperimentDomain {
  constructor(private readonly host: OrchestratorMergeExperimentHost) {}

  getMergeNode(workflowId: string): TaskState | undefined {
    return this.host.stateMachine.getAllTasks().find(
      (t) => t.config.workflowId === workflowId && t.config.isMergeNode,
    );
  }

  reconcileMergeLeaves(workflowId: string): void {
    reconcileMergeLeavesImpl(this.graphMutationHost(), workflowId);
    assertMergeLeavesInvariantImpl(this.graphMutationHost(), workflowId);
  }

  assertMergeLeavesInvariant(workflowId: string): void {
    const host = this.graphMutationHost();
    assertMergeLeavesInvariantImpl(host, workflowId);
    assertMergeExperimentDependenciesInvariantImpl(host, workflowId);
  }

  applyGraphMutation(mutation: GraphMutation): TaskDelta[] {
    return applyGraphMutationImpl(this.graphMutationHost(), mutation);
  }

  checkExperimentCompletion(taskId: string): void {
    for (const recon of this.host.stateMachine.getAllTasks()) {
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
        const dep = this.host.stateGetTask(depId);
        return dep && (dep.status === 'completed' || dep.status === 'failed');
      });

      if (!allReported) continue;

      const experimentResults = recon.dependencies.map((depId) => {
        const dep = this.host.stateGetTask(depId)!;
        return {
          id: depId,
          status: (dep.status === 'completed' ? 'completed' : 'failed') as 'completed' | 'failed',
          summary: dep.config.summary,
          exitCode: dep.execution.exitCode,
        };
      });

      // Persist results only; reconciliation stays pending until the scheduler runs it.
      const reconChanges: TaskStateChanges = {
        execution: { experimentResults },
      };
      const reconUpdated = this.host.writeAndSync(recon.id, reconChanges);
      this.host.events.logAndPublishUpdate(
        recon.id,
        'task.experiment_results_recorded',
        recon,
        reconUpdated,
        reconChanges,
      );
    }
  }

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
    const isReSelection = previousSet !== undefined && !sameExperimentSet(previousSet, [winnerId]);
    const allTasksBefore = this.host.stateMachine.getAllTasks();

    if (isReSelection) {
      const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
      const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
      for (const dsId of downstreamIds) {
        const downstreamTask = this.host.stateGetTask(dsId);
        if (!downstreamTask) continue;
        if (this.host.isActiveForInvalidation(downstreamTask.status)) {
          this.host.cancelTask(dsId);
        }
      }
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
    const reconUpdated = this.host.writeAndSync(reconId, changes);
    this.host.updateSelectedAttempt(reconId, {
      status: 'completed',
      completedAt: changes.execution?.completedAt,
      branch: winner?.execution.branch,
      commit: winner?.execution.commit,
    });
    this.host.events.logAndPublishUpdate(reconId, 'task.completed', task, reconUpdated, changes);

    if (isReSelection) {
      const directDownstream = allTasksBefore
        .filter((t) => t.dependencies.includes(reconId))
        .map((t) => t.id);
      for (const dsId of directDownstream) {
        this.host.recreateTask(dsId);
      }
    }

    const readyTaskIds = this.host.findNewlyReadyTasks(reconId);
    this.host.logger.info('[orchestrator] selectExperiment', {
      taskId: reconId,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = this.host.autoStartReadyTasks(readyTaskIds);
    this.host.checkWorkflowCompletion();
    return started;
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
    const isReSelection = previousSet !== undefined && !sameExperimentSet(previousSet, experimentIds);

    const allTasksBefore = this.host.stateMachine.getAllTasks();

    if (isReSelection) {
      const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
      const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
      for (const dsId of downstreamIds) {
        const downstreamTask = this.host.stateGetTask(dsId);
        if (!downstreamTask) continue;
        if (this.host.isActiveForInvalidation(downstreamTask.status)) {
          this.host.cancelTask(dsId);
        }
      }
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
    const reconUpdated = this.host.writeAndSync(reconId, changes);
    this.host.updateSelectedAttempt(reconId, {
      status: 'completed',
      completedAt: changes.execution?.completedAt,
      branch: combinedBranch,
      commit: combinedCommit,
    });
    this.host.events.logAndPublishUpdate(reconId, 'task.completed', task, reconUpdated, changes);

    if (isReSelection) {
      const directDownstreamAfter = this.host.stateMachine
        .getAllTasks()
        .filter((t) => t.dependencies.includes(reconId))
        .map((t) => t.id);
      for (const dsId of directDownstreamAfter) {
        if (this.host.stateGetTask(dsId)) {
          this.host.recreateTask(dsId);
        }
      }
    }

    const readyTaskIds = this.host.findNewlyReadyTasks(reconId);
    this.host.logger.info('[orchestrator] selectExperiments', {
      taskId: reconId,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = this.host.autoStartReadyTasks(readyTaskIds);
    this.host.checkWorkflowCompletion();
    return started;
  }

  editTaskMergeMode(taskId: string, mergeMode: MergeMode): TaskState[] {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task) throw this.host.createTaskNotFoundError(`Task ${taskId} not found`);
    if (!task.config.isMergeNode) {
      throw new Error(`Task ${taskId} is not a merge node`);
    }
    const workflowId = task.config.workflowId;
    if (!workflowId) {
      throw new Error(`Merge node ${taskId} has no workflowId`);
    }

    const wf = this.host.persistence.loadWorkflow?.(workflowId);
    if (wf && wf.mergeMode === mergeMode) {
      return [];
    }

    if (this.host.isActiveForInvalidation(task.status)) {
      this.host.cancelTask(taskId);
    }

    this.host.persistence.updateWorkflow?.(workflowId, { mergeMode });
    return this.host.dispatchPostMutation(MUTATION_POLICIES.mergeMode.action, taskId);
  }

  private graphMutationHost(): GraphMutationHost {
    return {
      stateMachine: this.host.stateMachine,
      persistence: this.host.persistence,
      events: this.host.events,
      writeAndSync: (taskId, changes) => this.host.writeAndSync(taskId, changes),
      createAndSync: (task) => this.host.createAndSync(task),
      getMergeNode: (workflowId) => this.getMergeNode(workflowId),
    };
  }
}
