import type { TaskState } from '@invoker/workflow-graph';
import type { InvalidationAction } from '../invalidation-policy.js';
import { MUTATION_POLICIES } from '../invalidation-policy.js';
import type { OrchestratorPersistence } from '../orchestrator.js';

export interface MergeDomainHost {
  persistence: OrchestratorPersistence;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  createTaskNotFoundError(taskId: string): Error;
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
}

function isActiveForMergeInvalidation(status: TaskState['status']): boolean {
  return (
    status === 'running' ||
    status === 'fixing_with_ai' ||
    status === 'awaiting_approval' ||
    status === 'review_ready'
  );
}

export function editTaskMergeMode(
  host: MergeDomainHost,
  taskId: string,
  mergeMode: 'manual' | 'automatic' | 'external_review',
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) throw host.createTaskNotFoundError(taskId);
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

  if (isActiveForMergeInvalidation(task.status)) {
    host.cancelTask(taskId);
  }

  host.persistence.updateWorkflow?.(workflowId, { mergeMode });

  return host.dispatchPostMutation(MUTATION_POLICIES.mergeMode.action, taskId);
}
