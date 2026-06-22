import type { HeadlessDeps } from './headless-types.js';

export function restoreWorkflowForTask(
  taskId: string,
  deps: Pick<HeadlessDeps, 'orchestrator' | 'persistence'>,
): { workflowId: string; resolvedTaskId: string } {
  const restored = tryRestoreWorkflowForTask(taskId, deps);
  if (restored) {
    return restored;
  }
  throw new Error(`Task "${taskId}" not found in any workflow`);
}

export function tryRestoreWorkflowForTask(
  taskId: string,
  deps: Pick<HeadlessDeps, 'orchestrator' | 'persistence'>,
): { workflowId: string; resolvedTaskId: string } | null {
  const { orchestrator, persistence } = deps;
  const workflows = persistence.listWorkflows();
  for (const wf of workflows) {
    const tasks = persistence.loadTasks(wf.id);
    const match = tasks.find(t => t.id === taskId || t.id.endsWith('/' + taskId));
    if (match) {
      // Keep lookup read-only: load graph state from DB without starting tasks.
      orchestrator.syncFromDb(wf.id);
      return { workflowId: wf.id, resolvedTaskId: match.id };
    }
  }
  return null;
}

export function restoreWorkflowForTaskUnlessDeleteAllWon(
  taskId: string,
  deps: Pick<HeadlessDeps, 'orchestrator' | 'persistence'>,
  commandLabel: string,
): { workflowId: string; resolvedTaskId: string } | null {
  const restored = tryRestoreWorkflowForTask(taskId, deps);
  if (restored) {
    return restored;
  }
  if (deps.persistence.listWorkflows().length === 0) {
    process.stdout.write(`[headless] ${commandLabel} skipped: task "${taskId}" was removed by delete-all.\n`);
    return null;
  }
  throw new Error(`Task "${taskId}" not found in any workflow`);
}

export async function withRestoredTaskUnlessDeleteAllWon<T>(
  taskId: string,
  deps: Pick<HeadlessDeps, 'orchestrator' | 'persistence'>,
  commandLabel: string,
  run: (restored: { workflowId: string; resolvedTaskId: string }) => Promise<T>,
): Promise<T | undefined> {
  const restored = restoreWorkflowForTaskUnlessDeleteAllWon(taskId, deps, commandLabel);
  if (!restored) return undefined;
  return await run(restored);
}
