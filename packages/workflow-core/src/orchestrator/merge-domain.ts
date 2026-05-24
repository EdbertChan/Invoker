import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { TaskState } from '@invoker/workflow-graph';
import type { InvalidationAction } from '../invalidation-policy.js';
import { MUTATION_POLICIES } from '../invalidation-policy.js';
import { OrchestratorError, OrchestratorErrorCode, type PlanDefinition } from '../orchestrator.js';

const MERGE_TRACE_LOG = resolve(homedir(), '.invoker', 'merge-trace.log');

export function mergeTrace(tag: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(resolve(homedir(), '.invoker'), { recursive: true });
    appendFileSync(MERGE_TRACE_LOG, `${new Date().toISOString()} [merge-trace:orchestrator] ${tag} ${JSON.stringify(data)}\n`);
  } catch {
    // best effort
  }
}

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

export interface MergeDomainHost {
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  isActiveForInvalidation(status: TaskState['status']): boolean;
  loadWorkflow(workflowId: string): { mergeMode?: 'manual' | 'automatic' | 'external_review' } | undefined;
  updateWorkflow(workflowId: string, changes: { mergeMode?: 'manual' | 'automatic' | 'external_review' }): void;
  cancelTask(taskId: string): void;
  dispatchPostMutation(action: InvalidationAction, taskId: string): TaskState[];
}

export class OrchestratorMergeDomain {
  constructor(private readonly host: MergeDomainHost) {}

  editTaskMergeMode(
    taskId: string,
    mergeMode: 'manual' | 'automatic' | 'external_review',
  ): TaskState[] {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task) {
      throw new OrchestratorError(OrchestratorErrorCode.TASK_NOT_FOUND, `Task ${taskId} not found`);
    }
    if (!task.config.isMergeNode) {
      throw new Error(`Task ${taskId} is not a merge node`);
    }
    const workflowId = task.config.workflowId;
    if (!workflowId) {
      throw new Error(`Merge node ${taskId} has no workflowId`);
    }

    const wf = this.host.loadWorkflow(workflowId);
    if (wf && wf.mergeMode === mergeMode) {
      return [];
    }

    if (this.host.isActiveForInvalidation(task.status)) {
      this.host.cancelTask(taskId);
    }

    this.host.updateWorkflow(workflowId, { mergeMode });
    return this.host.dispatchPostMutation(MUTATION_POLICIES.mergeMode.action, taskId);
  }
}
