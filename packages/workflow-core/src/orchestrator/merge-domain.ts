import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { TaskState } from '@invoker/workflow-graph';
import {
  assertMergeExperimentDependenciesInvariantImpl,
  assertMergeLeavesInvariantImpl,
  reconcileMergeLeavesImpl,
} from '../graph-mutation.js';
import type { GraphMutationHost } from '../graph-mutation.js';

const MERGE_TRACE_LOG = resolve(homedir(), '.invoker', 'merge-trace.log');

export function mergeTrace(tag: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(resolve(homedir(), '.invoker'), { recursive: true });
    appendFileSync(MERGE_TRACE_LOG, `${new Date().toISOString()} [merge-trace:orchestrator] ${tag} ${JSON.stringify(data)}\n`);
  } catch {
    // best effort
  }
}

export function descriptionForMergeNode(plan: {
  name: string;
  onFinish?: 'none' | 'merge' | 'pull_request';
  mergeMode?: 'manual' | 'automatic' | 'external_review';
}): string {
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

export class OrchestratorMergeDomain {
  constructor(private readonly host: GraphMutationHost) {}

  getMergeNode(workflowId: string): TaskState | undefined {
    return this.host.stateMachine.getAllTasks().find(
      (task) => task.config.workflowId === workflowId && task.config.isMergeNode,
    );
  }

  reconcileMergeLeaves(workflowId: string): void {
    reconcileMergeLeavesImpl(this.host, workflowId);
    assertMergeLeavesInvariantImpl(this.host, workflowId);
  }

  assertMergeLeavesInvariant(workflowId: string): void {
    assertMergeLeavesInvariantImpl(this.host, workflowId);
    assertMergeExperimentDependenciesInvariantImpl(this.host, workflowId);
  }
}
