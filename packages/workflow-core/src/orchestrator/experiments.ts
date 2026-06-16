import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import { MUTATION_POLICIES, type InvalidationAction } from '../invalidation-policy.js';
import { scopePlanTaskId } from '../task-id-scope.js';
import type { GraphMutation, GraphMutationNodeDef, OrchestratorPersistence } from '../orchestrator.js';

export interface ExperimentDomainHost {
  stateMachine: {
    getAllTasks(): TaskState[];
    findNewlyReadyTasks(taskId: string): string[];
  };
  persistence: OrchestratorPersistence;
  logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(
    taskId: string,
    changes: {
      status?: Attempt['status'];
      completedAt?: Date;
      branch?: string;
      commit?: string;
    },
  ): void;
  publishTaskUpdate(
    before: TaskState,
    after: TaskState,
    changes: TaskStateChanges,
    eventName?: string,
  ): TaskDelta;
  applyGraphMutation(mutation: GraphMutation): TaskDelta[];
  autoStartReadyTasks(taskIds: string[], priority?: number, opts?: { bypassLocalDependencyReadiness?: boolean }): TaskState[];
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
  checkWorkflowCompletion(): void;
}

function canonicalize(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function isActiveForExperimentInvalidation(status: TaskState['status']): boolean {
  return (
    status === 'running' ||
    status === 'fixing_with_ai' ||
    status === 'awaiting_approval' ||
    status === 'review_ready'
  );
}

function previousSelectedExperimentSet(task: TaskState): readonly string[] | undefined {
  return task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
}

function isReselection(previousSet: readonly string[] | undefined, nextSet: readonly string[]): boolean {
  const nextCanon = canonicalize(nextSet);
  const prevCanon = previousSet ? canonicalize(previousSet) : undefined;
  return (
    previousSet !== undefined &&
    !(
      prevCanon !== undefined &&
      prevCanon.length === nextCanon.length &&
      prevCanon.every((id, i) => id === nextCanon[i])
    )
  );
}

function cancelActiveDownstream(host: ExperimentDomainHost, reconId: string, allTasksBefore: TaskState[]): void {
  const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
  const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
  for (const dsId of downstreamIds) {
    const dt = host.stateGetTask(dsId);
    if (!dt) continue;
    if (isActiveForExperimentInvalidation(dt.status)) {
      host.cancelTask(dsId);
    }
  }
}

export function handleSpawnExperiments(
  host: ExperimentDomainHost,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'spawn_experiments' }>,
): TaskState[] {
  const parentTask = host.stateGetTask(taskId);
  const wfId = parentTask?.config.workflowId;
  if (!wfId) {
    host.logger.warn('[orchestrator] handleSpawnExperiments: missing workflowId; skipping', {
      taskId,
    });
    return [];
  }
  const scopeLocal = (local: string) => scopePlanTaskId(wfId, local);

  const experimentTasks: GraphMutationNodeDef[] = parsed.variants.map((v) => ({
    id: scopeLocal(v.id),
    description: v.description ?? `Experiment: ${v.id}`,
    dependencies: [taskId],
    workflowId: wfId,
    parentTask: taskId,
    experimentPrompt: v.prompt,
    prompt: v.prompt,
    command: v.command,
    runnerKind: parentTask?.config.runnerKind,
  }));

  const reconciliationId = `${taskId}-reconciliation`;
  const newNodes: GraphMutationNodeDef[] = [
    ...experimentTasks,
    {
      id: reconciliationId,
      description: `Review and select winning experiment for ${taskId}`,
      dependencies: experimentTasks.map((t) => t.id),
      workflowId: wfId,
      parentTask: taskId,
      isReconciliation: true,
      requiresManualApproval: true,
    },
  ];

  const wf =
    typeof host.persistence.loadWorkflow === 'function'
      ? host.persistence.loadWorkflow(wfId)
      : undefined;
  const pivotBranch =
    wf && typeof (wf as { baseBranch?: string }).baseBranch === 'string'
      ? (wf as { baseBranch: string }).baseBranch.trim()
      : '';
  const sourceChanges =
    pivotBranch !== '' ? { execution: { branch: pivotBranch } } : undefined;

  host.applyGraphMutation({
    sourceNodeId: taskId,
    sourceDisposition: 'complete',
    sourceChanges,
    newNodes,
    outputNodeId: reconciliationId,
  });

  const readyIds = experimentTasks.map((t) => t.id);
  return host.autoStartReadyTasks(readyIds);
}

export function handleSelectExperiment(
  host: ExperimentDomainHost,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'select_experiment' }>,
): TaskState[] {
  return selectExperiment(host, taskId, parsed.experimentId);
}

export function selectExperiment(
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
  const previousSet = previousSelectedExperimentSet(task);
  const reselection = isReselection(previousSet, [winnerId]);
  const allTasksBefore = host.stateMachine.getAllTasks();
  if (reselection) {
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
  host.publishTaskUpdate(task, reconUpdated, changes, 'task.completed');

  if (reselection) {
    const directDownstream = allTasksBefore
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    const reselectionAction = MUTATION_POLICIES.selectedExperiment.action;
    for (const dsId of directDownstream) {
      host.dispatchPostMutation(reselectionAction, dsId);
    }
  }
  const readyTaskIds = host.stateMachine.findNewlyReadyTasks(reconId);
  host.logger.info('[orchestrator] selectExperiment', {
    taskId: reconId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  host.checkWorkflowCompletion();
  return started;
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
  const reconId = task.id;

  const previousSet = previousSelectedExperimentSet(task);
  const reselection = isReselection(previousSet, experimentIds);

  const allTasksBefore = host.stateMachine.getAllTasks();

  if (reselection) {
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
  host.publishTaskUpdate(task, reconUpdated, changes, 'task.completed');

  if (reselection) {
    const directDownstreamAfter = host.stateMachine
      .getAllTasks()
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    const reselectionAction = MUTATION_POLICIES.selectedExperimentSet.action;
    for (const dsId of directDownstreamAfter) {
      if (host.stateGetTask(dsId)) {
        host.dispatchPostMutation(reselectionAction, dsId);
      }
    }
  }

  const readyTaskIds = host.stateMachine.findNewlyReadyTasks(reconId);
  host.logger.info('[orchestrator] selectExperiments', {
    taskId: reconId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  host.checkWorkflowCompletion();
  return started;
}

export function checkExperimentCompletion(host: ExperimentDomainHost, taskId: string): void {
  for (const recon of host.stateMachine.getAllTasks()) {
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

    if (allReported) {
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
      host.publishTaskUpdate(
        recon,
        reconUpdated,
        reconChanges,
        'task.experiment_results_recorded',
      );
    }
  }
}
