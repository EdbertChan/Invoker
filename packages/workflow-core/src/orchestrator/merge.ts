import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const MERGE_TRACE_LOG = resolve(homedir(), '.invoker', 'merge-trace.log');

export interface MergeNodeDescriptionPlan {
  name: string;
  onFinish?: 'none' | 'merge' | 'pull_request';
  mergeMode?: 'manual' | 'automatic' | 'external_review';
}

export function mergeTrace(tag: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(resolve(homedir(), '.invoker'), { recursive: true });
    appendFileSync(MERGE_TRACE_LOG, `${new Date().toISOString()} [merge-trace:orchestrator] ${tag} ${JSON.stringify(data)}\n`);
  } catch {
    // best effort
  }
}

/** User-visible merge-node description aligned with `onFinish` / `mergeMode` (list + graph subtitle). */
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
