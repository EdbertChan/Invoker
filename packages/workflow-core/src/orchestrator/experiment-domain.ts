import type { Logger } from '@invoker/contracts';
import { getTransitiveDependents, type Attempt, type TaskDelta, type TaskState, type TaskStateChanges, type TaskStatus } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import { scopePlanTaskId } from '../task-id-scope.js';
import { MUTATION_POLICIES, type InvalidationAction } from '../invalidation-policy.js';
import type { GraphMutation, GraphMutationNodeDef, OrchestratorPersistence } from '../orchestrator.js';

function isActiveForInvalidation(status: TaskStatus): boolean {
  return (
    status === 'running' ||
    status === 'fixing_with_ai' ||
    status === 'awaiting_approval' ||
    status === 'review_ready'
  );
}

export interface ExperimentDomainDeps {
  readonly logger: Logger;
  readonly persistence: OrchestratorPersistence;
  readonly stateGetTask: (taskId: string) => TaskState | undefined;
  readonly getAllTasks: () => TaskState[];
  readonly writeAndSync: (taskId: string, changes: TaskStateChanges) => TaskState;
  readonly updateSelectedAttempt: (
    taskId: string,
    changes: Partial<Pick<Attempt, 'status' | 'completedAt' | 'branch' | 'commit'>>,
  ) => void;
  readonly buildUpdateDelta: (
    before: TaskState,
    after: TaskState,
    changes: TaskStateChanges,
  ) => TaskDelta;
  readonly publishTaskDelta: (delta: TaskDelta) => void;
  readonly applyGraphMutation: (mutation: GraphMutation) => TaskDelta[];
  readonly autoStartReadyTasks: (taskIds: string[], priority?: number) => TaskState[];
  readonly checkWorkflowCompletion: () => void;
  readonly findNewlyReadyTasks: (taskId: string) => string[];
  readonly cancelTask: (taskId: string) => void;
  readonly dispatchPostMutation: (action: InvalidationAction, taskId: string) => TaskState[];
}

export function handleSpawnExperiments(
  deps: ExperimentDomainDeps,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'spawn_experiments' }>,
): TaskState[] {
  const parentTask = deps.stateGetTask(taskId);
  const wfId = parentTask?.config.workflowId;
  if (!wfId) {
    deps.logger.warn('[orchestrator] handleSpawnExperiments: missing workflowId; skipping', {
      taskId,
    });
    return [];
  }
  const scopeLocal = (local: string) => scopePlanTaskId(wfId, local);

  const experimentTasks: GraphMutationNodeDef[] = parsed.variants.map((variant) => ({
    id: scopeLocal(variant.id),
    description: variant.description ?? `Experiment: ${variant.id}`,
    dependencies: [taskId],
    workflowId: wfId,
    parentTask: taskId,
    experimentPrompt: variant.prompt,
    prompt: variant.prompt,
    command: variant.command,
    runnerKind: parentTask?.config.runnerKind,
  }));

  const reconciliationId = `${taskId}-reconciliation`;
  const newNodes: GraphMutationNodeDef[] = [
    ...experimentTasks,
    {
      id: reconciliationId,
      description: `Review and select winning experiment for ${taskId}`,
      dependencies: experimentTasks.map((task) => task.id),
      workflowId: wfId,
      parentTask: taskId,
      isReconciliation: true,
      requiresManualApproval: true,
    },
  ];

  const wf =
    wfId && typeof deps.persistence.loadWorkflow === 'function'
      ? deps.persistence.loadWorkflow(wfId)
      : undefined;
  const pivotBranch =
    wf && typeof (wf as { baseBranch?: string }).baseBranch === 'string'
      ? (wf as { baseBranch: string }).baseBranch.trim()
      : '';
  const sourceChanges =
    pivotBranch !== '' ? { execution: { branch: pivotBranch } } : undefined;

  deps.applyGraphMutation({
    sourceNodeId: taskId,
    sourceDisposition: 'complete',
    sourceChanges,
    newNodes,
    outputNodeId: reconciliationId,
  });

  return deps.autoStartReadyTasks(experimentTasks.map((task) => task.id));
}

export function selectExperiment(
  deps: ExperimentDomainDeps,
  taskId: string,
  experimentId: string,
): TaskState[] {
  const task = deps.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const winner = deps.stateGetTask(experimentId);
  const winnerId = winner?.id ?? experimentId;
  const previousSet = task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
  const canonicalize = (ids: readonly string[]) =>
    Array.from(new Set(ids)).slice().sort();
  const newCanon = canonicalize([winnerId]);
  const prevCanon = previousSet ? canonicalize(previousSet) : undefined;
  const sameAsPrev =
    prevCanon !== undefined &&
    prevCanon.length === newCanon.length &&
    prevCanon.every((id, i) => id === newCanon[i]);
  const isReSelection = previousSet !== undefined && !sameAsPrev;
  const allTasksBefore = deps.getAllTasks();
  if (isReSelection) {
    const taskMapBefore = new Map(allTasksBefore.map((candidate) => [candidate.id, candidate]));
    const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
    for (const dsId of downstreamIds) {
      const downstream = deps.stateGetTask(dsId);
      if (!downstream) continue;
      if (isActiveForInvalidation(downstream.status)) {
        deps.cancelTask(dsId);
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
  const reconUpdated = deps.writeAndSync(reconId, changes);
  deps.updateSelectedAttempt(reconId, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: winner?.execution.branch,
    commit: winner?.execution.commit,
  });
  deps.persistence.logEvent?.(reconId, 'task.completed', changes);
  deps.publishTaskDelta(deps.buildUpdateDelta(task, reconUpdated, changes));

  if (isReSelection) {
    const directDownstream = allTasksBefore
      .filter((candidate) => candidate.dependencies.includes(reconId))
      .map((candidate) => candidate.id);
    const reselectionAction = MUTATION_POLICIES.selectedExperiment.action;
    for (const dsId of directDownstream) {
      deps.dispatchPostMutation(reselectionAction, dsId);
    }
  }

  const readyTaskIds = deps.findNewlyReadyTasks(reconId);
  deps.logger.info('[orchestrator] selectExperiment', {
    taskId: reconId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = deps.autoStartReadyTasks(readyTaskIds);
  deps.checkWorkflowCompletion();
  return started;
}

export function selectExperiments(
  deps: ExperimentDomainDeps,
  taskId: string,
  experimentIds: string[],
  combinedBranch?: string,
  combinedCommit?: string,
): TaskState[] {
  const task = deps.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const previousSet = task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
        ? [task.execution.selectedExperiment]
        : undefined);
  const canonicalize = (ids: readonly string[]) =>
    Array.from(new Set(ids)).slice().sort();
  const newCanon = canonicalize(experimentIds);
  const prevCanon = previousSet ? canonicalize(previousSet) : undefined;
  const sameAsPrev =
    prevCanon !== undefined &&
    prevCanon.length === newCanon.length &&
    prevCanon.every((id, i) => id === newCanon[i]);
  const isReSelection = previousSet !== undefined && !sameAsPrev;

  const allTasksBefore = deps.getAllTasks();

  if (isReSelection) {
    const taskMapBefore = new Map(allTasksBefore.map((candidate) => [candidate.id, candidate]));
    const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
    for (const dsId of downstreamIds) {
      const downstream = deps.stateGetTask(dsId);
      if (!downstream) continue;
      if (isActiveForInvalidation(downstream.status)) {
        deps.cancelTask(dsId);
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
  const reconUpdated = deps.writeAndSync(reconId, changes);
  deps.updateSelectedAttempt(reconId, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: combinedBranch,
    commit: combinedCommit,
  });
  deps.persistence.logEvent?.(reconId, 'task.completed', changes);
  deps.publishTaskDelta(deps.buildUpdateDelta(task, reconUpdated, changes));

  if (isReSelection) {
    const directDownstreamAfter = deps.getAllTasks()
      .filter((candidate) => candidate.dependencies.includes(reconId))
      .map((candidate) => candidate.id);
    const reselectionAction = MUTATION_POLICIES.selectedExperimentSet.action;
    for (const dsId of directDownstreamAfter) {
      if (deps.stateGetTask(dsId)) {
        deps.dispatchPostMutation(reselectionAction, dsId);
      }
    }
  }

  const readyTaskIds = deps.findNewlyReadyTasks(reconId);
  deps.logger.info('[orchestrator] selectExperiments', {
    taskId: reconId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = deps.autoStartReadyTasks(readyTaskIds);
  deps.checkWorkflowCompletion();
  return started;
}

export function checkExperimentCompletion(deps: ExperimentDomainDeps, taskId: string): void {
  for (const recon of deps.getAllTasks()) {
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
      const dep = deps.stateGetTask(depId);
      return dep && (dep.status === 'completed' || dep.status === 'failed');
    });

    if (allReported) {
      const experimentResults = recon.dependencies.map((depId) => {
        const dep = deps.stateGetTask(depId)!;
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
      const reconUpdated = deps.writeAndSync(recon.id, reconChanges);
      deps.persistence.logEvent?.(recon.id, 'task.experiment_results_recorded', reconChanges);
      deps.publishTaskDelta(deps.buildUpdateDelta(recon, reconUpdated, reconChanges));
    }
  }
}
