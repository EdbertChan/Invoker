import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import type {
  GraphMutation,
  GraphMutationNodeDef,
  OrchestratorPersistence,
} from '../orchestrator.js';
import { MUTATION_POLICIES, type InvalidationAction } from '../invalidation-policy.js';
import { scopePlanTaskId } from '../task-id-scope.js';

export function descriptionForMergeNode(plan: {
  name: string;
  onFinish?: 'none' | 'merge' | 'pull_request';
  mergeMode?: 'manual' | 'automatic' | 'external_review';
}): string {
  const onFinish = plan.onFinish ?? 'none';
  const mergeMode = plan.mergeMode ?? 'manual';
  if (mergeMode === 'external_review') {
    return `Review gate for ${plan.name}`;
  }
  if (onFinish === 'pull_request') {
    return `Pull request gate for ${plan.name}`;
  }
  if (onFinish === 'merge') {
    return `Merge gate for ${plan.name}`;
  }
  return `Workflow gate for ${plan.name}`;
}

export function isActiveForInvalidation(status: TaskState['status']): boolean {
  return (
    status === 'running' ||
    status === 'fixing_with_ai' ||
    status === 'awaiting_approval' ||
    status === 'review_ready'
  );
}

export interface MergeExperimentHost {
  logger: Logger;
  persistence: OrchestratorPersistence;
  stateMachine: {
    getAllTasks(): TaskState[];
    findNewlyReadyTasks(taskId: string): string[];
  };
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(
    taskId: string,
    changes: Partial<Pick<Attempt, 'status' | 'completedAt' | 'branch' | 'commit'>>,
  ): void;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  publishTaskDelta(delta: TaskDelta): void;
  applyGraphMutation(mutation: GraphMutation): TaskDelta[];
  autoStartReadyTasks(taskIds: string[], priority?: number, opts?: { bypassLocalDependencyReadiness?: boolean }): TaskState[];
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
  checkWorkflowCompletion(): void;
  makeTaskNotFoundError(taskId: string, message: string): Error;
}

function canonicalizeExperimentIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function isReselection(task: TaskState, nextIds: readonly string[]): boolean {
  const previousSet = task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
  if (previousSet === undefined) return false;

  const nextCanon = canonicalizeExperimentIds(nextIds);
  const prevCanon = canonicalizeExperimentIds(previousSet);
  return !(
    prevCanon.length === nextCanon.length &&
    prevCanon.every((id, i) => id === nextCanon[i])
  );
}

function cancelActiveDownstream(host: MergeExperimentHost, reconId: string): TaskState[] {
  const allTasksBefore = host.stateMachine.getAllTasks();
  const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
  const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
  for (const dsId of downstreamIds) {
    const dt = host.stateGetTask(dsId);
    if (!dt) continue;
    if (isActiveForInvalidation(dt.status)) {
      host.cancelTask(dsId);
    }
  }
  return allTasksBefore;
}

export function selectExperiment(
  host: MergeExperimentHost,
  taskId: string,
  experimentId: string,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const winner = host.stateGetTask(experimentId);
  const winnerId = winner?.id ?? experimentId;
  const isReSelection = isReselection(task, [winnerId]);
  const allTasksBefore = isReSelection
    ? cancelActiveDownstream(host, reconId)
    : host.stateMachine.getAllTasks();

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
  host.publishTaskDelta(delta);

  if (isReSelection) {
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
  host: MergeExperimentHost,
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

  const isReSelection = isReselection(task, experimentIds);
  if (isReSelection) {
    cancelActiveDownstream(host, reconId);
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
  host.publishTaskDelta(delta);

  if (isReSelection) {
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
    selectedExperiments: experimentIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  host.checkWorkflowCompletion();
  return started;
}

export function handleSpawnExperiments(
  host: MergeExperimentHost,
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
    wfId && typeof host.persistence.loadWorkflow === 'function'
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
  host: MergeExperimentHost,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'select_experiment' }>,
): TaskState[] {
  return selectExperiment(host, taskId, parsed.experimentId);
}

export function checkExperimentCompletion(host: MergeExperimentHost, taskId: string): void {
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
      const delta = host.buildUpdateDelta(recon, reconUpdated, reconChanges);
      host.persistence.logEvent?.(recon.id, 'task.experiment_results_recorded', reconChanges);
      host.publishTaskDelta(delta);
    }
  }
}

export function editTaskMergeMode(
  host: MergeExperimentHost,
  taskId: string,
  mergeMode: 'manual' | 'automatic' | 'external_review',
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) throw host.makeTaskNotFoundError(taskId, `Task ${taskId} not found`);
  if (!task.config.isMergeNode) {
    throw new Error(`Task ${taskId} is not a merge node`);
  }
  const workflowId = task.config.workflowId;
  if (!workflowId) {
    throw new Error(`Merge node ${taskId} has no workflowId`);
  }

  const wf = host.persistence.loadWorkflow?.(workflowId);
  if (wf && wf.mergeMode === mergeMode) {
    return [];
  }

  if (isActiveForInvalidation(task.status)) {
    host.cancelTask(taskId);
  }

  host.persistence.updateWorkflow?.(workflowId, { mergeMode });

  return host.dispatchPostMutation(MUTATION_POLICIES.mergeMode.action, taskId);
}
