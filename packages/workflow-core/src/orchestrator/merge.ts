import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { TaskState, TaskStatus } from '@invoker/workflow-graph';
import { MUTATION_POLICIES, type InvalidationAction } from '../invalidation-policy.js';
import type { OrchestratorPersistence, PlanDefinition } from '../orchestrator.js';

const MERGE_TRACE_LOG = resolve(homedir(), '.invoker', 'merge-trace.log');

export type MergeMode = 'manual' | 'automatic' | 'external_review';

export function mergeTrace(tag: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(resolve(homedir(), '.invoker'), { recursive: true });
    appendFileSync(MERGE_TRACE_LOG, `${new Date().toISOString()} [merge-trace:orchestrator] ${tag} ${JSON.stringify(data)}\n`);
  } catch { /* best effort */ }
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

function isActiveForInvalidation(status: TaskStatus): boolean {
  return (
    status === 'running' ||
    status === 'fixing_with_ai' ||
    status === 'awaiting_approval' ||
    status === 'review_ready'
  );
}

export interface OrchestratorMergeHost {
  persistence: OrchestratorPersistence;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  cancelTask(taskId: string): void;
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
  taskNotFoundError(taskId: string): Error;
}

export function editTaskMergeMode(
  host: OrchestratorMergeHost,
  taskId: string,
  mergeMode: MergeMode,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) throw host.taskNotFoundError(taskId);
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
