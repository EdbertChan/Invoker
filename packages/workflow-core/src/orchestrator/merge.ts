import { createTaskState } from '@invoker/workflow-graph';
import type { TaskState, TaskStatus } from '@invoker/workflow-graph';
import type { PlanDefinition } from '../orchestrator.js';

export type MergeMode = 'manual' | 'automatic' | 'external_review';

export interface OrchestratorMergeContext {
  loadWorkflowMergeMode(workflowId: string): MergeMode | undefined;
  updateWorkflowMergeMode(workflowId: string, mergeMode: MergeMode): void;
  isActiveForInvalidation(status: TaskStatus): boolean;
  cancelTask(taskId: string): void;
  dispatchPostMutation(action: string, taskId: string): TaskState[];
}

/** User-visible merge-node description aligned with `onFinish` / `mergeMode` (list + graph subtitle). */
export function descriptionForMergeNode(plan: Pick<PlanDefinition, 'name' | 'onFinish' | 'mergeMode'>): string {
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

export function buildMergeNodeTask(
  workflowId: string,
  leafIds: string[],
  plan: Pick<PlanDefinition, 'name' | 'onFinish' | 'mergeMode'>,
): TaskState {
  return createTaskState(
    `__merge__${workflowId}`,
    descriptionForMergeNode(plan),
    leafIds,
    { workflowId, isMergeNode: true, runnerKind: 'merge' },
  );
}

export function editTaskMergeModeImpl(
  ctx: OrchestratorMergeContext,
  task: TaskState,
  mergeMode: MergeMode,
  mutationAction: string,
): TaskState[] {
  const workflowId = task.config.workflowId;
  if (!workflowId) {
    throw new Error(`Merge node ${task.id} has no workflowId`);
  }

  const currentMergeMode = ctx.loadWorkflowMergeMode(workflowId);
  if (currentMergeMode === mergeMode) {
    return [];
  }

  if (ctx.isActiveForInvalidation(task.status)) {
    ctx.cancelTask(task.id);
  }

  ctx.updateWorkflowMergeMode(workflowId, mergeMode);
  return ctx.dispatchPostMutation(mutationAction, task.id);
}
