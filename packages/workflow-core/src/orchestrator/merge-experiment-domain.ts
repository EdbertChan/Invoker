import type { Logger } from '@invoker/contracts';
import type { ExecutorType, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { createTaskState } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import { scopePlanTaskId } from '../task-id-scope.js';

interface MergePlanSummary {
  name: string;
  onFinish?: 'none' | 'merge' | 'pull_request';
  mergeMode?: 'manual' | 'automatic' | 'external_review';
}

export function descriptionForMergeNodeImpl(
  plan: MergePlanSummary,
): string {
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

export function createWorkflowMergeTask(
  workflowId: string,
  plan: MergePlanSummary,
  leafIds: string[],
): TaskState {
  return createTaskState(
    `__merge__${workflowId}`,
    descriptionForMergeNodeImpl(plan),
    leafIds,
    { workflowId, isMergeNode: true, executorType: 'merge' },
  );
}

interface ExperimentPersistence {
  loadWorkflow?(workflowId: string): { baseBranch?: string } | undefined;
  logEvent?(taskId: string, eventType: string, payload?: unknown): void;
}

interface ExperimentGraphMutationNodeDef {
  id: string;
  description: string;
  dependencies: string[];
  workflowId?: string;
  parentTask?: string;
  experimentPrompt?: string;
  prompt?: string;
  command?: string;
  executorType?: ExecutorType;
  isReconciliation?: boolean;
  requiresManualApproval?: boolean;
  isMergeNode?: boolean;
}

interface ExperimentGraphMutation {
  sourceNodeId: string;
  sourceDisposition: 'complete' | 'stale';
  sourceChanges?: TaskStateChanges;
  newNodes: ExperimentGraphMutationNodeDef[];
  outputNodeId: string;
}

export interface OrchestratorExperimentHost {
  persistence: ExperimentPersistence;
  logger: Logger;
  stateMachine: {
    getAllTasks(): TaskState[];
  };
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  publishDelta(delta: TaskDelta): void;
  applyGraphMutation(mutation: ExperimentGraphMutation): TaskDelta[];
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
}

export function handleSpawnExperimentsImpl(
  host: OrchestratorExperimentHost,
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

  const experimentTasks: ExperimentGraphMutationNodeDef[] = parsed.variants.map((variant) => ({
    id: scopeLocal(variant.id),
    description: variant.description ?? `Experiment: ${variant.id}`,
    dependencies: [taskId],
    workflowId: wfId,
    parentTask: taskId,
    experimentPrompt: variant.prompt,
    prompt: variant.prompt,
    command: variant.command,
    executorType: parentTask.config.executorType,
  }));

  const reconciliationId = `${taskId}-reconciliation`;
  const newNodes: ExperimentGraphMutationNodeDef[] = [
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

  const workflow =
    typeof host.persistence.loadWorkflow === 'function'
      ? host.persistence.loadWorkflow(wfId)
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

export function checkExperimentCompletionImpl(
  host: OrchestratorExperimentHost,
  taskId: string,
): void {
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
    const delta = host.buildUpdateDelta(recon, reconUpdated, reconChanges);
    host.persistence.logEvent?.(recon.id, 'task.experiment_results_recorded', reconChanges);
    host.publishDelta(delta);
  }
}
