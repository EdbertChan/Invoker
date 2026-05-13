import { randomUUID } from 'node:crypto';

import type { TaskState, ExperimentVariant } from '@invoker/workflow-core';
import type { WorkRequest, WorkResponse } from '@invoker/contracts';
import type { Executor } from './executor.js';
import { DEFAULT_EXECUTION_AGENT } from './agent.js';
import { formatLifecycleTag, extractAttemptSuffix } from './branch-utils.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from './exec-trace.js';

export type PreparedTaskExecution =
  | { kind: 'synthetic-response'; response: WorkResponse }
  | { kind: 'dispatch'; request: WorkRequest; executor: Executor };

export interface TaskRunnerPrepareHost {
  orchestrator: {
    getTask: (taskId: string) => TaskState | undefined;
  };
  persistence: {
    loadWorkflow?: (workflowId: string) => any;
    updateAttempt?: (attemptId: string, changes: any) => void;
    updateTask: (taskId: string, changes: any) => void;
  };
  defaultBranch: string | undefined;
  buildUpstreamContext(task: TaskState): Promise<Array<{taskId: string; description: string; summary?: string; commitHash?: string; commitMessage?: string}>>;
  collectUpstreamBranches(task: TaskState): string[];
  buildAlternatives(task: TaskState): Array<{taskId: string; description: string; branch?: string; commitHash?: string; status: 'completed' | 'failed'; exitCode?: number; summary?: string; selected?: boolean}>;
  resolveDependencyTask(workflowId: string, taskId?: string): TaskState | undefined;
  isLaunchStale(taskId: string, attemptId: string, startGeneration: number): boolean;
  determineActionType(task: TaskState): WorkRequest['actionType'];
  shouldUseFreshWorkspace(task: TaskState): boolean;
  selectExecutor(task: TaskState): Executor;
}

export async function prepareTaskExecution(
  host: TaskRunnerPrepareHost,
  task: TaskState,
  attemptId: string,
): Promise<PreparedTaskExecution> {
  if (task.config.pivot && task.config.experimentVariants && task.config.experimentVariants.length > 0) {
    return {
      kind: 'synthetic-response',
      response: {
        requestId: `req-${task.id}`,
        actionId: task.id,
        attemptId,
        executionGeneration: task.execution.generation ?? 0,
        status: 'spawn_experiments',
        outputs: {},
        dagMutation: {
          spawnExperiments: {
            description: task.description,
            variants: task.config.experimentVariants.map((v: ExperimentVariant) => ({
              id: v.id,
              description: v.description,
              prompt: v.prompt,
              command: v.command,
            })),
          },
        },
      },
    };
  }

  traceExecution(
    `${RESTART_TO_BRANCH_TRACE} executeTaskInner taskId=${task.id} (past pivot check) → gather upstreams + build WorkRequest`,
  );

  const upstreamContext = await host.buildUpstreamContext(task);
  const upstreamBranches = host.collectUpstreamBranches(task);
  const alternatives = host.buildAlternatives(task);

  if (!task.config.isMergeNode) {
    for (const depId of task.dependencies) {
      const dep = host.orchestrator.getTask(depId);
      if (dep && dep.status === 'completed' && !dep.execution.branch) {
        throw new Error(
          `Task "${task.id}": dependency "${depId}" completed without branch metadata` +
          ` — upstream changes would be silently dropped. The plan may need to be restarted.`,
        );
      }
    }
    for (const depRef of task.config.externalDependencies ?? []) {
      const dep = host.resolveDependencyTask(depRef.workflowId, depRef.taskId);
      if (dep && dep.status === 'completed' && !dep.execution.branch) {
        throw new Error(
          `Task "${task.id}": external dependency "${depRef.workflowId}/${depRef.taskId}" completed without branch metadata` +
          ` — upstream changes would be silently dropped. The plan may need to be restarted.`,
        );
      }
    }
  }

  const workflow = task.config.workflowId ? host.persistence.loadWorkflow?.(task.config.workflowId) : undefined;
  const workflowGeneration = (workflow as any)?.generation ?? 0;
  const taskExecutionGeneration = task.execution.generation ?? 0;
  const lifecycleTag = formatLifecycleTag({
    wfGen: workflowGeneration,
    taskGen: taskExecutionGeneration,
    attemptShort: extractAttemptSuffix(attemptId, task.id),
  });
  const baseBranch = workflow?.baseBranch ?? host.defaultBranch;
  const repoUrl = workflow?.repoUrl;
  const intermediateRepoUrl = workflow?.intermediateRepoUrl;

  let branchPersistedEarly = false;
  const startGeneration = task.execution.generation ?? 0;
  const onBranchResolved = (branch: string): void => {
    if (!branch || branchPersistedEarly) return;
    if (host.isLaunchStale(task.id, attemptId, startGeneration)) return;
    branchPersistedEarly = true;
    try {
      host.persistence.updateAttempt?.(attemptId, { branch } as any);
      host.persistence.updateTask(task.id, {
        execution: { branch } as any,
      });
      traceExecution(
        `${RESTART_TO_BRANCH_TRACE} task=${task.id} attempt=${attemptId} branch persisted early branch=${branch}`,
      );
    } catch (err) {
      traceExecution(
        `${RESTART_TO_BRANCH_TRACE} task=${task.id} attempt=${attemptId} early branch persist failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const request: WorkRequest = {
    requestId: randomUUID(),
    actionId: task.id,
    attemptId,
    executionGeneration: task.execution.generation ?? 0,
    actionType: host.determineActionType(task),
    inputs: {
      description: task.description,
      command: task.config.command,
      prompt: task.config.prompt,
      executionAgent: task.config.executionAgent?.trim() || DEFAULT_EXECUTION_AGENT,
      repoUrl,
      intermediateRepoUrl,
      featureBranch: task.config.featureBranch,
      upstreamContext: upstreamContext.length > 0 ? upstreamContext : undefined,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      upstreamBranches: upstreamBranches.length > 0 ? upstreamBranches : undefined,
      lifecycleTag,
      baseBranch,
      freshWorkspace: host.shouldUseFreshWorkspace(task),
    },
    callbackUrl: '',
    timestamps: {
      createdAt: new Date().toISOString(),
    },
    onBranchResolved,
  };

  traceExecution(
    `${RESTART_TO_BRANCH_TRACE} executeTaskInner taskId=${task.id} WorkRequest built actionType=${request.actionType} repoUrl=${request.inputs.repoUrl ?? '(none)'} upstreamBranches=${JSON.stringify(request.inputs.upstreamBranches ?? [])}`,
  );
  const executor = host.selectExecutor(task);
  traceExecution(
    `${RESTART_TO_BRANCH_TRACE} executeTaskInner taskId=${task.id} selectExecutor → type=${executor.type} calling executor.start()`,
  );

  return { kind: 'dispatch', request, executor };
}
