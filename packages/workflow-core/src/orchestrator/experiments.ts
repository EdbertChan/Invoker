import type { Logger } from '@invoker/contracts';
import type { Attempt, RunnerKind, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import { scopePlanTaskId } from '../task-id-scope.js';
import {
  publishTaskUpdate,
  type TaskEventHost,
} from './events.js';

interface ExperimentPersistence {
  loadWorkflow?(workflowId: string): { baseBranch?: string } | undefined;
  updateAttempt(
    attemptId: string,
    changes: Partial<Pick<Attempt, 'status' | 'completedAt' | 'branch' | 'commit'>>,
  ): void;
}

interface GraphMutationNodeDef {
  id: string;
  description: string;
  dependencies: string[];
  workflowId?: string;
  parentTask?: string;
  experimentPrompt?: string;
  prompt?: string;
  command?: string;
  runnerKind?: RunnerKind;
  isReconciliation?: boolean;
  requiresManualApproval?: boolean;
}

interface GraphMutation {
  sourceNodeId: string;
  sourceDisposition: 'complete' | 'stale';
  sourceChanges?: TaskStateChanges;
  newNodes: GraphMutationNodeDef[];
  outputNodeId: string;
}

export interface ExperimentHost extends TaskEventHost {
  readonly persistence: ExperimentPersistence & TaskEventHost['persistence'];
  readonly logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(
    taskId: string,
    changes: Parameters<ExperimentPersistence['updateAttempt']>[1],
  ): void;
  findNewlyReadyTasks(taskId: string): string[];
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  recreateTask(taskId: string): TaskState[];
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  checkWorkflowCompletion(): void;
  applyGraphMutation(mutation: GraphMutation): TaskDelta[];
}

function canonicalize(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function previousExperimentSet(task: TaskState): readonly string[] | undefined {
  return task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
}

function isSameExperimentSet(previous: readonly string[] | undefined, next: readonly string[]): boolean {
  if (!previous) return false;
  const prevCanon = canonicalize(previous);
  const nextCanon = canonicalize(next);
  return prevCanon.length === nextCanon.length && prevCanon.every((id, index) => id === nextCanon[index]);
}

function isActiveForExperimentInvalidation(status: TaskState['status']): boolean {
  return (
    status === 'running' ||
    status === 'fixing_with_ai' ||
    status === 'awaiting_approval' ||
    status === 'review_ready'
  );
}

function cancelActiveDownstream(host: ExperimentHost, reconId: string, allTasksBefore: TaskState[]): void {
  const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
  const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
  for (const downstreamId of downstreamIds) {
    const downstreamTask = host.stateGetTask(downstreamId);
    if (downstreamTask && isActiveForExperimentInvalidation(downstreamTask.status)) {
      host.cancelTask(downstreamId);
    }
  }
}

function completeReconciliation(
  host: ExperimentHost,
  task: TaskState,
  changes: TaskStateChanges,
): void {
  const reconUpdated = host.writeAndSync(task.id, changes);
  host.updateSelectedAttempt(task.id, {
    status: 'completed',
    completedAt: changes.execution?.completedAt,
    branch: changes.execution?.branch,
    commit: changes.execution?.commit,
  });
  publishTaskUpdate(host, task, reconUpdated, changes, 'task.completed');
}

export function selectExperiment(
  host: ExperimentHost,
  taskId: string,
  experimentId: string,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || !task.config.isReconciliation) return [];
  const reconId = task.id;

  const winner = host.stateGetTask(experimentId);
  const winnerId = winner?.id ?? experimentId;
  const previousSet = previousExperimentSet(task);
  const isReSelection = previousSet !== undefined && !isSameExperimentSet(previousSet, [winnerId]);
  const allTasksBefore = host.getAllTasks();
  if (isReSelection) {
    cancelActiveDownstream(host, reconId, allTasksBefore);
  }

  completeReconciliation(host, task, {
    status: 'completed',
    execution: {
      selectedExperiment: winnerId,
      completedAt: new Date(),
      branch: winner?.execution.branch,
      commit: winner?.execution.commit,
    },
  });

  if (isReSelection) {
    const directDownstream = allTasksBefore
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    for (const downstreamId of directDownstream) {
      host.recreateTask(downstreamId);
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

export function selectExperiments(
  host: ExperimentHost,
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

  const previousSet = previousExperimentSet(task);
  const isReSelection = previousSet !== undefined && !isSameExperimentSet(previousSet, experimentIds);
  const allTasksBefore = host.getAllTasks();
  if (isReSelection) {
    cancelActiveDownstream(host, reconId, allTasksBefore);
  }

  completeReconciliation(host, task, {
    status: 'completed',
    execution: {
      selectedExperiment: experimentIds[0],
      selectedExperiments: experimentIds,
      completedAt: new Date(),
      branch: combinedBranch,
      commit: combinedCommit,
    },
  });

  if (isReSelection) {
    const directDownstreamAfter = host.getAllTasks()
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    for (const downstreamId of directDownstreamAfter) {
      if (host.stateGetTask(downstreamId)) {
        host.recreateTask(downstreamId);
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

export function handleSpawnExperiments(
  host: ExperimentHost,
  taskId: string,
  variants: Array<{ id: string; description?: string; prompt?: string; command?: string }>,
): TaskState[] {
  const parentTask = host.stateGetTask(taskId);
  const workflowId = parentTask?.config.workflowId;
  if (!workflowId) {
    host.logger.warn('[orchestrator] handleSpawnExperiments: missing workflowId; skipping', {
      taskId,
    });
    return [];
  }

  const scopeLocal = (local: string) => scopePlanTaskId(workflowId, local);
  const experimentTasks: GraphMutationNodeDef[] = variants.map((variant) => ({
    id: scopeLocal(variant.id),
    description: variant.description ?? `Experiment: ${variant.id}`,
    dependencies: [taskId],
    workflowId,
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
      dependencies: experimentTasks.map((t) => t.id),
      workflowId,
      parentTask: taskId,
      isReconciliation: true,
      requiresManualApproval: true,
    },
  ];

  const workflow =
    typeof host.persistence.loadWorkflow === 'function'
      ? host.persistence.loadWorkflow(workflowId)
      : undefined;
  const pivotBranch =
    workflow && typeof (workflow as { baseBranch?: string }).baseBranch === 'string'
      ? (workflow as { baseBranch: string }).baseBranch.trim()
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

  return host.autoStartReadyTasks(experimentTasks.map((task) => task.id));
}

export function checkExperimentCompletion(host: ExperimentHost, taskId: string): void {
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

    const changes: TaskStateChanges = {
      execution: { experimentResults },
    };
    const reconUpdated = host.writeAndSync(recon.id, changes);
    publishTaskUpdate(host, recon, reconUpdated, changes, 'task.experiment_results_recorded');
  }
}
