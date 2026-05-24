import type { TaskState } from '@invoker/workflow-graph';
import type { InvalidationAction } from '../invalidation-policy.js';

export type MergeMode = 'manual' | 'automatic' | 'external_review';

export interface MergePlanDescription {
  name: string;
  onFinish?: 'none' | 'merge' | 'pull_request';
  mergeMode?: MergeMode;
}

export function descriptionForMergeNode(plan: MergePlanDescription): string {
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

export interface MergeDomainHost {
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  makeTaskNotFoundError(taskId: string): Error;
  persistence: {
    loadWorkflow?(workflowId: string): { mergeMode?: MergeMode } | undefined;
    updateWorkflow?(workflowId: string, changes: { mergeMode?: MergeMode }): void;
  };
  isActiveForInvalidationStatus(status: TaskState['status']): boolean;
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
}

export function editTaskMergeModeImpl(
  host: MergeDomainHost,
  taskId: string,
  mergeMode: MergeMode,
  action: InvalidationAction,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
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

  if (host.isActiveForInvalidationStatus(task.status)) {
    host.cancelTask(taskId);
  }

  host.persistence.updateWorkflow?.(workflowId, { mergeMode });
  return host.dispatchPostMutation(action, taskId);
}
