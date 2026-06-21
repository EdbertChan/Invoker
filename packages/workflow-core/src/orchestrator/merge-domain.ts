import type { Logger } from '@invoker/contracts';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import type { Attempt, TaskState, TaskStateChanges, TaskStatus } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import { MUTATION_POLICIES, type InvalidationAction } from '../invalidation-policy.js';
import {
  assertMergeExperimentDependenciesInvariantImpl,
  assertMergeLeavesInvariantImpl,
  reconcileMergeLeavesImpl,
} from '../graph-mutation.js';
import type { GraphMutationHost } from '../graph-mutation.js';
import { scopePlanTaskId } from '../task-id-scope.js';
import type {
  GraphMutation,
  GraphMutationNodeDef,
  OrchestratorPersistence,
} from '../orchestrator.js';

type MergeMode = 'manual' | 'automatic' | 'external_review';

export interface MergeExperimentDomainHost {
  persistence: OrchestratorPersistence;
  logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(
    taskId: string,
    changes: Partial<Pick<Attempt, 'status' | 'completedAt' | 'branch' | 'commit'>>,
  ): void;
  publishTaskUpdate(
    before: TaskState,
    after: TaskState,
    changes: TaskStateChanges,
    eventName?: string,
  ): void;
  cancelTask(taskId: string): unknown;
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
  findNewlyReadyTasks(taskId: string): string[];
  autoStartReadyTasks(taskIds: string[], priority?: number, opts?: { bypassLocalDependencyReadiness?: boolean }): TaskState[];
  checkWorkflowCompletion(): void;
  applyGraphMutation(mutation: GraphMutation): unknown;
  taskNotFoundError(context: string, taskId: string): Error;
}

/** User-visible merge-node description aligned with `onFinish` / `mergeMode` (list + graph subtitle). */
export function descriptionForMergeNode(plan: {
  name: string;
  onFinish?: 'none' | 'merge' | 'pull_request';
  mergeMode?: MergeMode;
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

export function getMergeNodeDomain(tasks: readonly TaskState[], workflowId: string): TaskState | undefined {
  return tasks.find((t) => t.config.workflowId === workflowId && t.config.isMergeNode);
}

export function reconcileMergeLeavesDomain(host: GraphMutationHost, workflowId: string): void {
  reconcileMergeLeavesImpl(host, workflowId);
  assertMergeLeavesInvariantImpl(host, workflowId);
}

export function assertMergeInvariantsDomain(host: GraphMutationHost, workflowId: string): void {
  assertMergeLeavesInvariantImpl(host, workflowId);
  assertMergeExperimentDependenciesInvariantImpl(host, workflowId);
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

export function selectExperimentDomain(
  host: MergeExperimentDomainHost,
  taskId: string,
  experimentId: string,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const winner = host.stateGetTask(experimentId);
  const winnerId = winner?.id ?? experimentId;
  const previousSet = task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
  const newCanon = canonicalize([winnerId]);
  const prevCanon = previousSet ? canonicalize(previousSet) : undefined;
  const sameAsPrev =
    prevCanon !== undefined &&
    prevCanon.length === newCanon.length &&
    prevCanon.every((id, i) => id === newCanon[i]);
  const isReSelection = previousSet !== undefined && !sameAsPrev;
  const allTasksBefore = host.getAllTasks();
  if (isReSelection) {
    const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
    const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
    for (const dsId of downstreamIds) {
      const dt = host.stateGetTask(dsId);
      if (!dt) continue;
      if (isActiveForInvalidation(dt.status)) {
        host.cancelTask(dsId);
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
  const reconUpdated = host.writeAndSync(reconId, changes);
  host.updateSelectedAttempt(reconId, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: winner?.execution.branch,
    commit: winner?.execution.commit,
  });
  host.publishTaskUpdate(task, reconUpdated, changes, 'task.completed');

  if (isReSelection) {
    const directDownstream = allTasksBefore
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    const reselectionAction = MUTATION_POLICIES.selectedExperiment.action;
    for (const dsId of directDownstream) {
      host.dispatchPostMutation(reselectionAction, dsId);
    }
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
  host: MergeExperimentDomainHost,
  taskId: string,
  experimentIds: string[],
  combinedBranch?: string,
  combinedCommit?: string,
): TaskState[] {
  if (experimentIds.length === 1) {
    return selectExperimentDomain(host, taskId, experimentIds[0]);
  }

  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const previousSet = task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
        ? [task.execution.selectedExperiment]
        : undefined);
  const newCanon = canonicalize(experimentIds);
  const prevCanon = previousSet ? canonicalize(previousSet) : undefined;
  const sameAsPrev =
    prevCanon !== undefined &&
    prevCanon.length === newCanon.length &&
    prevCanon.every((id, i) => id === newCanon[i]);
  const isReSelection = previousSet !== undefined && !sameAsPrev;

  const allTasksBefore = host.getAllTasks();

  if (isReSelection) {
    const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
    const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
    for (const dsId of downstreamIds) {
      const dt = host.stateGetTask(dsId);
      if (!dt) continue;
      if (isActiveForInvalidation(dt.status)) {
        host.cancelTask(dsId);
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
  const reconUpdated = host.writeAndSync(reconId, changes);
  host.updateSelectedAttempt(reconId, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: combinedBranch,
    commit: combinedCommit,
  });
  host.publishTaskUpdate(task, reconUpdated, changes, 'task.completed');

  if (isReSelection) {
    const directDownstreamAfter = host.getAllTasks()
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    const reselectionAction = MUTATION_POLICIES.selectedExperimentSet.action;
    for (const dsId of directDownstreamAfter) {
      if (host.stateGetTask(dsId)) {
        host.dispatchPostMutation(reselectionAction, dsId);
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

export function editTaskMergeModeDomain(
  host: MergeExperimentDomainHost,
  taskId: string,
  mergeMode: MergeMode,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) throw host.taskNotFoundError('editTaskMergeMode', taskId);
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

export function handleSpawnExperimentsDomain(
  host: MergeExperimentDomainHost,
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

export function checkExperimentCompletionDomain(host: MergeExperimentDomainHost, taskId: string): void {
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
      host.publishTaskUpdate(recon, reconUpdated, reconChanges, 'task.experiment_results_recorded');
    }
  }
}
