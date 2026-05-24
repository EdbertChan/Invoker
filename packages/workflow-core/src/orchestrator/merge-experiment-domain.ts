import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges, TaskStatus } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import { scopePlanTaskId } from '../task-id-scope.js';
import { MUTATION_POLICIES } from '../invalidation-policy.js';

export interface MergeExperimentPersistence {
  loadWorkflow?(workflowId: string): { baseBranch?: string; mergeMode?: 'manual' | 'automatic' | 'external_review' } | undefined;
  updateWorkflow?(workflowId: string, changes: { mergeMode?: 'manual' | 'automatic' | 'external_review' }): void;
  logEvent?(taskId: string, eventType: string, payload?: unknown): void;
}

export interface MergeExperimentNodeDef {
  id: string;
  description: string;
  dependencies: string[];
  workflowId?: string;
  parentTask?: string;
  experimentPrompt?: string;
  prompt?: string;
  command?: string;
  runnerKind?: TaskState['config']['runnerKind'];
  isReconciliation?: boolean;
  requiresManualApproval?: boolean;
}

export interface MergeExperimentGraphMutation {
  sourceNodeId: string;
  sourceDisposition: 'complete' | 'stale';
  sourceChanges?: TaskStateChanges;
  newNodes: MergeExperimentNodeDef[];
  outputNodeId: string;
}

export interface MergeExperimentDomainHost {
  logger: Logger;
  persistence: MergeExperimentPersistence;
  refreshFromDb(): void;
  getTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(
    taskId: string,
    changes: Partial<Pick<Attempt, 'status' | 'completedAt' | 'branch' | 'commit'>>,
  ): void;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  publishTaskDelta(delta: TaskDelta): void;
  applyGraphMutation(mutation: MergeExperimentGraphMutation): TaskDelta[];
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  findNewlyReadyTasks(taskId: string): string[];
  cancelTask(taskId: string): unknown;
  recreateTask(taskId: string): TaskState[];
  dispatchPostMutation(action: string, taskId: string): TaskState[];
  checkWorkflowCompletion(): void;
  makeTaskNotFoundError(taskId: string): Error;
  isActiveForInvalidation(status: TaskStatus): boolean;
}

export interface MergeExperimentDomain {
  selectExperiment(taskId: string, experimentId: string): TaskState[];
  selectExperiments(taskId: string, experimentIds: string[], combinedBranch?: string, combinedCommit?: string): TaskState[];
  editTaskMergeMode(taskId: string, mergeMode: 'manual' | 'automatic' | 'external_review'): TaskState[];
  handleSpawnExperiments(
    taskId: string,
    parsed: { variants: Array<{ id: string; description?: string; prompt?: string; command?: string }> },
  ): TaskState[];
  checkExperimentCompletion(taskId: string): void;
}

function canonicalize(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function getPreviousExperimentSet(task: TaskState): readonly string[] | undefined {
  return task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
}

function isSameExperimentSet(previousSet: readonly string[] | undefined, nextSet: readonly string[]): boolean {
  if (!previousSet) return false;
  const prevCanon = canonicalize(previousSet);
  const newCanon = canonicalize(nextSet);
  return prevCanon.length === newCanon.length && prevCanon.every((id, i) => id === newCanon[i]);
}

export function createMergeExperimentDomain(host: MergeExperimentDomainHost): MergeExperimentDomain {
  function cancelActiveDownstream(reconId: string, allTasksBefore: TaskState[]): void {
    const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
    const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
    for (const dsId of downstreamIds) {
      const downstream = host.getTask(dsId);
      if (downstream && host.isActiveForInvalidation(downstream.status)) {
        host.cancelTask(dsId);
      }
    }
  }

  function recreateDirectDownstream(reconId: string, tasks: TaskState[]): void {
    const directDownstream = tasks
      .filter((t) => t.dependencies.includes(reconId))
      .map((t) => t.id);
    for (const dsId of directDownstream) {
      if (host.getTask(dsId)) {
        host.recreateTask(dsId);
      }
    }
  }

  function finishSelection(
    reconBefore: TaskState,
    changes: TaskStateChanges,
    isReSelection: boolean,
    downstreamSnapshot: TaskState[],
    logLabel: 'selectExperiment' | 'selectExperiments',
  ): TaskState[] {
    const reconUpdated = host.writeAndSync(reconBefore.id, changes);
    host.updateSelectedAttempt(reconBefore.id, {
      status: 'completed',
      completedAt: changes.execution?.completedAt,
      branch: changes.execution?.branch,
      commit: changes.execution?.commit,
    });
    host.persistence.logEvent?.(reconBefore.id, 'task.completed', changes);
    host.publishTaskDelta(host.buildUpdateDelta(reconBefore, reconUpdated, changes));

    if (isReSelection) {
      recreateDirectDownstream(reconBefore.id, downstreamSnapshot);
    }

    const readyTaskIds = host.findNewlyReadyTasks(reconBefore.id);
    host.logger.info(`[orchestrator] ${logLabel}`, {
      taskId: reconBefore.id,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = host.autoStartReadyTasks(readyTaskIds);
    host.checkWorkflowCompletion();
    return started;
  }

  function selectExperiment(taskId: string, experimentId: string): TaskState[] {
    host.refreshFromDb();
    const task = host.getTask(taskId);
    if (!task || !task.config.isReconciliation) return [];

    const winner = host.getTask(experimentId);
    const winnerId = winner?.id ?? experimentId;
    const previousSet = getPreviousExperimentSet(task);
    const isReSelection = previousSet !== undefined && !isSameExperimentSet(previousSet, [winnerId]);
    const allTasksBefore = host.getAllTasks();
    if (isReSelection) {
      cancelActiveDownstream(task.id, allTasksBefore);
    }

    return finishSelection(
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
      isReSelection,
      allTasksBefore,
      'selectExperiment',
    );
  }

  function selectExperiments(
    taskId: string,
    experimentIds: string[],
    combinedBranch?: string,
    combinedCommit?: string,
  ): TaskState[] {
    if (experimentIds.length === 1) {
      return selectExperiment(taskId, experimentIds[0]);
    }

    host.refreshFromDb();
    const task = host.getTask(taskId);
    if (!task || !task.config.isReconciliation) return [];

    const previousSet = getPreviousExperimentSet(task);
    const isReSelection = previousSet !== undefined && !isSameExperimentSet(previousSet, experimentIds);
    const allTasksBefore = host.getAllTasks();
    if (isReSelection) {
      cancelActiveDownstream(task.id, allTasksBefore);
    }

    return finishSelection(
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
      isReSelection,
      host.getAllTasks(),
      'selectExperiments',
    );
  }

  function editTaskMergeMode(
    taskId: string,
    mergeMode: 'manual' | 'automatic' | 'external_review',
  ): TaskState[] {
    host.refreshFromDb();
    const task = host.getTask(taskId);
    if (!task) throw host.makeTaskNotFoundError(taskId);
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

    if (host.isActiveForInvalidation(task.status)) {
      host.cancelTask(taskId);
    }

    host.persistence.updateWorkflow?.(workflowId, { mergeMode });
    return host.dispatchPostMutation(MUTATION_POLICIES.mergeMode.action, taskId);
  }

  function handleSpawnExperiments(
    taskId: string,
    parsed: { variants: Array<{ id: string; description?: string; prompt?: string; command?: string }> },
  ): TaskState[] {
    const parentTask = host.getTask(taskId);
    const wfId = parentTask?.config.workflowId;
    if (!wfId) {
      host.logger.warn('[orchestrator] handleSpawnExperiments: missing workflowId; skipping', {
        taskId,
      });
      return [];
    }
    const scopeLocal = (local: string) => scopePlanTaskId(wfId, local);

    const experimentTasks: MergeExperimentNodeDef[] = parsed.variants.map((v) => ({
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
    const newNodes: MergeExperimentNodeDef[] = [
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

    const wf = host.persistence.loadWorkflow?.(wfId);
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

    return host.autoStartReadyTasks(experimentTasks.map((t) => t.id));
  }

  function checkExperimentCompletion(taskId: string): void {
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
        const dep = host.getTask(depId);
        return dep && (dep.status === 'completed' || dep.status === 'failed');
      });

      if (!allReported) continue;

      const experimentResults = recon.dependencies.map((depId) => {
        const dep = host.getTask(depId)!;
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
      host.persistence.logEvent?.(recon.id, 'task.experiment_results_recorded', reconChanges);
      host.publishTaskDelta(host.buildUpdateDelta(recon, reconUpdated, reconChanges));
    }
  }

  return {
    selectExperiment,
    selectExperiments,
    editTaskMergeMode,
    handleSpawnExperiments,
    checkExperimentCompletion,
  };
}
