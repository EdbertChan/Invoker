import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createTaskState, type TaskState } from '@invoker/workflow-graph';
import {
  assertMergeExperimentDependenciesInvariantImpl,
  assertMergeLeavesInvariantImpl,
  reconcileMergeLeavesImpl,
  type GraphMutationHost,
} from '../graph-mutation.js';

const MERGE_TRACE_LOG = resolve(homedir(), '.invoker', 'merge-trace.log');

export interface MergePlanDescriptor {
  name: string;
  onFinish?: 'none' | 'merge' | 'pull_request';
  mergeMode?: 'manual' | 'automatic' | 'external_review';
}

export function mergeTrace(tag: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(resolve(homedir(), '.invoker'), { recursive: true });
    appendFileSync(MERGE_TRACE_LOG, `${new Date().toISOString()} [merge-trace:orchestrator] ${tag} ${JSON.stringify(data)}\n`);
  } catch { /* best effort */ }
}

/** User-visible merge-node description aligned with `onFinish` / `mergeMode` (list + graph subtitle). */
export function descriptionForMergeNode(plan: MergePlanDescriptor): string {
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

export function buildMergeTask(
  plan: MergePlanDescriptor,
  workflowId: string,
  leafIds: string[],
): TaskState {
  return createTaskState(
    `__merge__${workflowId}`,
    descriptionForMergeNode(plan),
    leafIds,
    { workflowId, isMergeNode: true, runnerKind: 'merge' },
  );
}

export function getMergeNode(tasks: readonly TaskState[], workflowId: string): TaskState | undefined {
  return tasks.find((task) => task.config.workflowId === workflowId && task.config.isMergeNode);
}

export function reconcileMergeLeaves(host: GraphMutationHost, workflowId: string): void {
  reconcileMergeLeavesImpl(host, workflowId);
  assertMergeLeavesInvariantImpl(host, workflowId);
}

export function assertMergeInvariants(host: GraphMutationHost, workflowId: string): void {
  assertMergeLeavesInvariantImpl(host, workflowId);
  assertMergeExperimentDependenciesInvariantImpl(host, workflowId);
}
