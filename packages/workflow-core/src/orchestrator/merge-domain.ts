import type { TaskState, TaskStatus } from '@invoker/workflow-graph';
import type { InvalidationAction } from '../invalidation-policy.js';
import { MUTATION_POLICIES } from '../invalidation-policy.js';
import type { OrchestratorPersistence } from '../orchestrator.js';

function isActiveForMergeInvalidation(status: TaskStatus): boolean {
  return (
    status === 'running' ||
    status === 'fixing_with_ai' ||
    status === 'awaiting_approval' ||
    status === 'review_ready'
  );
}

export interface MergeModeDomainHost {
  readonly persistence: OrchestratorPersistence;

  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  cancelTask(taskId: string): void;
}

export function editTaskMergeMode(
  host: MergeModeDomainHost,
  taskId: string,
  mergeMode: 'manual' | 'automatic' | 'external_review',
  deps: {
    taskNotFound(taskId: string): Error;
    dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
  },
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) throw deps.taskNotFound(taskId);
  if (!task.config.isMergeNode) {
    throw new Error(`Task ${taskId} is not a merge node`);
  }
  const workflowId = task.config.workflowId;
  if (!workflowId) {
    throw new Error(`Merge node ${taskId} has no workflowId`);
  }

  const workflow = host.persistence.loadWorkflow?.(workflowId);
  if (workflow && workflow.mergeMode === mergeMode) {
    return [];
  }

  if (isActiveForMergeInvalidation(task.status)) {
    host.cancelTask(taskId);
  }

  host.persistence.updateWorkflow?.(workflowId, { mergeMode });
  return deps.dispatchPostMutation(MUTATION_POLICIES.mergeMode.action, taskId);
}
