import type { TaskState } from '@invoker/workflow-graph';
import {
  assertMergeExperimentDependenciesInvariantImpl,
  assertMergeLeavesInvariantImpl,
  reconcileMergeLeavesImpl,
  type GraphMutationHost,
} from '../graph-mutation.js';

export function getMergeNodeForWorkflow(tasks: readonly TaskState[], workflowId: string): TaskState | undefined {
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
