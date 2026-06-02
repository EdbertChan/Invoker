import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import { scopePlanTaskId } from '../task-id-scope.js';
import type { GraphMutation, GraphMutationNodeDef } from '../orchestrator.js';
import { isActiveForInvalidation } from './active-status.js';

interface ExperimentPersistence {
  loadWorkflow?(workflowId: string): { baseBranch?: string } | undefined;
}

interface ExperimentStateMachine {
  getAllTasks(): TaskState[];
  findNewlyReadyTasks(taskId: string): string[];
}

export interface OrchestratorExperimentsHost {
  persistence: ExperimentPersistence;
  logger: Logger;
  stateMachine: ExperimentStateMachine;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(
    taskId: string,
    changes: Partial<Pick<Attempt, 'status' | 'completedAt' | 'branch' | 'commit'>>,
  ): void;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  logTaskEvent(taskId: string, eventType: string, payload?: unknown): void;
  publishDelta(delta: TaskDelta): void;
  applyGraphMutation(mutation: GraphMutation): TaskDelta[];
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  recreateTask(taskId: string): TaskState[];
  checkWorkflowCompletion(): void;
}

function canonicalize(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

function sameCanonicalSet(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a) return false;
  const aCanon = canonicalize(a);
  const bCanon = canonicalize(b);
  return aCanon.length === bCanon.length && aCanon.every((id, i) => id === bCanon[i]);
}

function previousExperimentSet(task: TaskState): readonly string[] | undefined {
  return task.execution.selectedExperiments
    ?? (task.execution.selectedExperiment !== undefined
      ? [task.execution.selectedExperiment]
      : undefined);
}

export class OrchestratorExperiments {
  constructor(private readonly host: OrchestratorExperimentsHost) {}

  handleSpawnExperiments(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'spawn_experiments' }>,
  ): TaskState[] {
    const parentTask = this.host.stateGetTask(taskId);
    const wfId = parentTask?.config.workflowId;
    if (!wfId) {
      this.host.logger.warn('[orchestrator] handleSpawnExperiments: missing workflowId; skipping', {
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
      wfId && typeof this.host.persistence.loadWorkflow === 'function'
        ? this.host.persistence.loadWorkflow(wfId)
        : undefined;
    const pivotBranch =
      wf && typeof wf.baseBranch === 'string'
        ? wf.baseBranch.trim()
        : '';
    const sourceChanges: TaskStateChanges | undefined =
      pivotBranch !== '' ? { execution: { branch: pivotBranch } } : undefined;

    this.host.applyGraphMutation({
      sourceNodeId: taskId,
      sourceDisposition: 'complete',
      sourceChanges,
      newNodes,
      outputNodeId: reconciliationId,
    });

    const readyIds = experimentTasks.map((t) => t.id);
    return this.host.autoStartReadyTasks(readyIds);
  }

  handleSelectExperiment(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'select_experiment' }>,
  ): TaskState[] {
    return this.selectExperiment(taskId, parsed.experimentId);
  }

  selectExperiment(taskId: string, experimentId: string): TaskState[] {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task || !task.config.isReconciliation) return [];
    const reconId = task.id;

    const winner = this.host.stateGetTask(experimentId);
    const winnerId = winner?.id ?? experimentId;
    const previousSet = previousExperimentSet(task);
    const newCanon = canonicalize([winnerId]);
    const isReSelection = previousSet !== undefined && !sameCanonicalSet(previousSet, newCanon);
    const allTasksBefore = this.host.stateMachine.getAllTasks();
    if (isReSelection) {
      this.cancelActiveDownstream(reconId, allTasksBefore);
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
    const delta = this.host.buildUpdateDelta(task, reconUpdated, changes);
    this.host.logTaskEvent(reconId, 'task.completed', changes);
    this.host.publishDelta(delta);

    if (isReSelection) {
      const directDownstream = allTasksBefore
        .filter((t) => t.dependencies.includes(reconId))
        .map((t) => t.id);
      for (const dsId of directDownstream) {
        this.host.recreateTask(dsId);
      }
    }
    const readyTaskIds = this.host.stateMachine.findNewlyReadyTasks(reconId);
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

    const previousSet = previousExperimentSet(task);
    const newCanon = canonicalize(experimentIds);
    const isReSelection = previousSet !== undefined && !sameCanonicalSet(previousSet, newCanon);
    const allTasksBefore = this.host.stateMachine.getAllTasks();

    if (isReSelection) {
      this.cancelActiveDownstream(reconId, allTasksBefore);
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
    const delta = this.host.buildUpdateDelta(task, reconUpdated, changes);
    this.host.logTaskEvent(reconId, 'task.completed', changes);
    this.host.publishDelta(delta);

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

    const readyTaskIds = this.host.stateMachine.findNewlyReadyTasks(reconId);
    this.host.logger.info('[orchestrator] selectExperiments', {
      taskId: reconId,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = this.host.autoStartReadyTasks(readyTaskIds);
    this.host.checkWorkflowCompletion();
    return started;
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

      if (allReported) {
        const experimentResults = recon.dependencies.map((depId) => {
          const dep = this.host.stateGetTask(depId)!;
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
        const reconUpdated = this.host.writeAndSync(recon.id, reconChanges);
        const delta = this.host.buildUpdateDelta(recon, reconUpdated, reconChanges);
        this.host.logTaskEvent(recon.id, 'task.experiment_results_recorded', reconChanges);
        this.host.publishDelta(delta);
      }
    }
  }

  private cancelActiveDownstream(reconId: string, allTasksBefore: TaskState[]): void {
    const taskMapBefore = new Map(allTasksBefore.map((t) => [t.id, t]));
    const downstreamIds = getTransitiveDependents(reconId, taskMapBefore, () => false);
    for (const dsId of downstreamIds) {
      const dt = this.host.stateGetTask(dsId);
      if (!dt) continue;
      if (isActiveForInvalidation(dt.status)) {
        this.host.cancelTask(dsId);
      }
    }
  }
}
