import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { TaskState } from '@invoker/workflow-graph';
import { MUTATION_POLICIES, type InvalidationAction } from '../invalidation-policy.js';
import { isActiveForInvalidation } from './active-status.js';

export type MergeMode = 'manual' | 'automatic' | 'external_review';

export interface MergeNodeDescriptionPlan {
  name: string;
  onFinish?: 'none' | 'merge' | 'pull_request';
  mergeMode?: MergeMode;
}

export function descriptionForMergeNode(plan: MergeNodeDescriptionPlan): string {
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

const MERGE_TRACE_LOG = resolve(homedir(), '.invoker', 'merge-trace.log');

export function mergeTrace(tag: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(resolve(homedir(), '.invoker'), { recursive: true });
    appendFileSync(
      MERGE_TRACE_LOG,
      `${new Date().toISOString()} [merge-trace:orchestrator] ${tag} ${JSON.stringify(data)}\n`,
    );
  } catch {
    // best effort
  }
}

interface MergePersistence {
  loadWorkflow?(workflowId: string): { mergeMode?: MergeMode } | undefined;
  updateWorkflow?(workflowId: string, changes: { mergeMode?: MergeMode }): void;
}

export interface OrchestratorMergeHost {
  persistence: MergePersistence;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] };
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
  createTaskNotFoundError(message: string): Error;
}

export class OrchestratorMerge {
  constructor(private readonly host: OrchestratorMergeHost) {}

  editTaskMergeMode(taskId: string, mergeMode: MergeMode): TaskState[] {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task) throw this.host.createTaskNotFoundError(`Task ${taskId} not found`);
    if (!task.config.isMergeNode) {
      throw new Error(`Task ${taskId} is not a merge node`);
    }
    const workflowId = task.config.workflowId;
    if (!workflowId) {
      throw new Error(`Merge node ${taskId} has no workflowId`);
    }

    const wf = this.host.persistence.loadWorkflow?.(workflowId);
    if (wf && wf.mergeMode === mergeMode) {
      return [];
    }

    if (isActiveForInvalidation(task.status)) {
      this.host.cancelTask(taskId);
    }

    this.host.persistence.updateWorkflow?.(workflowId, { mergeMode });

    return this.host.dispatchPostMutation(MUTATION_POLICIES.mergeMode.action, taskId);
  }
}
