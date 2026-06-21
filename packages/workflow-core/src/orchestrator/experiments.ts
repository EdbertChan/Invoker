import type { Logger } from '@invoker/contracts';
import type { TaskDelta, TaskState, TaskStateChanges, TaskStatus } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import type { GraphMutation, GraphMutationNodeDef } from '../orchestrator.js';
import type { InvalidationAction } from '../invalidation-policy.js';
import { MUTATION_POLICIES } from '../invalidation-policy.js';
import { scopePlanTaskId } from '../task-id-scope.js';

export interface ExperimentDomainHost {
  logger: Logger;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  findNewlyReadyTasks(taskId: string): string[];
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
  publishTaskUpdate(before: TaskState, after: TaskState, changes: TaskStateChanges, eventName?: string): TaskDelta;
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
  autoStartReadyTasks(taskIds: string[]): TaskState[];
  checkWorkflowCompletion(): void;
  isActiveForInvalidation(status: TaskStatus): boolean;
  loadWorkflowBaseBranch(workflowId: string): string | undefined;
  applyGraphMutation(mutation: GraphMutation): TaskDelta[];
}

function canonicalize(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function previousExperimentSelection(task: TaskState): readonly string[] | undefined {
  return task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
}

function isReselection(task: TaskState, selectedIds: readonly string[]): boolean {
  const previousSet = previousExperimentSelection(task);
  const newCanon = canonicalize(selectedIds);
  const prevCanon = previousSet ? canonicalize(previousSet) : undefined;
  const sameAsPrev =
    prevCanon !== undefined &&
    prevCanon.length === newCanon.length &&
    prevCanon.every((id, index) => id === newCanon[index]);
  return previousSet !== undefined && !sameAsPrev;
}

function cancelActiveDownstream(host: ExperimentDomainHost, reconId: string, allTasksBefore: readonly TaskState[]): void {
  const taskMapBefore = new Map(allTasksBefore.map((task) => [task.id, task]));
  const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
  for (const downstreamId of downstreamIds) {
    const downstreamTask = host.stateGetTask(downstreamId);
    if (!downstreamTask) continue;
    if (host.isActiveForInvalidation(downstreamTask.status)) {
      host.cancelTask(downstreamId);
    }
  }
}

export function selectExperiments(
  host: ExperimentDomainHost,
  taskId: string,
  experimentIds: string[],
  combinedBranch?: string,
  combinedCommit?: string,
): TaskState[] {
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;
  const multiSelect = experimentIds.length > 1;

  const winner = !multiSelect ? host.stateGetTask(experimentIds[0]) : undefined;
  const selectedIds = multiSelect ? experimentIds : [winner?.id ?? experimentIds[0]];
  const branch = multiSelect ? combinedBranch : winner?.execution.branch;
  const commit = multiSelect ? combinedCommit : winner?.execution.commit;
  const reselection = isReselection(task, selectedIds);
  const allTasksBefore = host.getAllTasks();

  if (reselection) {
    cancelActiveDownstream(host, reconId, allTasksBefore);
  }

  const changes: TaskStateChanges = {
    status: 'completed',
    execution: {
      selectedExperiment: selectedIds[0],
      ...(multiSelect ? { selectedExperiments: selectedIds } : {}),
      completedAt: new Date(),
      branch,
      commit,
    },
  };
  const reconUpdated = host.writeAndSync(reconId, changes);
  host.updateSelectedAttempt(reconId, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch,
    commit,
  });
  host.publishTaskUpdate(task, reconUpdated, changes, 'task.completed');

  if (reselection) {
    const directDownstream = (multiSelect ? host.getAllTasks() : allTasksBefore)
      .filter((candidate) => candidate.dependencies.includes(reconId))
      .map((candidate) => candidate.id);
    const reselectionAction = multiSelect
      ? MUTATION_POLICIES.selectedExperimentSet.action
      : MUTATION_POLICIES.selectedExperiment.action;
    for (const downstreamId of directDownstream) {
      if (!multiSelect || host.stateGetTask(downstreamId)) {
        host.dispatchPostMutation(reselectionAction, downstreamId);
      }
    }
  }

  const readyTaskIds = host.findNewlyReadyTasks(reconId);
  host.logger.info(`[orchestrator] ${multiSelect ? 'selectExperiments' : 'selectExperiment'}`, {
    taskId: reconId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  host.checkWorkflowCompletion();
  return started;
}

export function buildSpawnExperimentsMutation(
  host: ExperimentDomainHost,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'spawn_experiments' }>,
): { mutation: GraphMutation; readyIds: string[] } | undefined {
  const parentTask = host.stateGetTask(taskId);
  const wfId = parentTask?.config.workflowId;
  if (!wfId) {
    host.logger.warn('[orchestrator] handleSpawnExperiments: missing workflowId; skipping', {
      taskId,
    });
    return undefined;
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

  const pivotBranch = host.loadWorkflowBaseBranch(wfId)?.trim() ?? '';
  return {
    mutation: {
      sourceNodeId: taskId,
      sourceDisposition: 'complete',
      sourceChanges: pivotBranch !== '' ? { execution: { branch: pivotBranch } } : undefined,
      newNodes,
      outputNodeId: reconciliationId,
    },
    readyIds: experimentTasks.map((task) => task.id),
  };
}

export function recordExperimentCompletion(host: ExperimentDomainHost, taskId: string): void {
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
    host.publishTaskUpdate(recon, reconUpdated, reconChanges, 'task.experiment_results_recorded');
  }
}
