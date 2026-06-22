import { randomUUID } from 'node:crypto';

import type { ExperimentVariant, TaskState } from '@invoker/workflow-core';
import type { ActionType, WorkRequest, WorkResponse } from '@invoker/contracts';

import type { LaunchDispatchOptions, TaskRunner } from './task-runner.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from './exec-trace.js';
import { formatLifecycleTag, extractAttemptSuffix } from './branch-utils.js';
import { DEFAULT_EXECUTION_AGENT } from './agent.js';

export type ExecuteTaskBench = (phase: string, metadata?: Record<string, unknown>) => void;

export type PreparedTaskExecution =
  | { kind: 'pivot' }
  | {
    kind: 'prepared';
    request: WorkRequest;
    actionType: ActionType;
    executionAgent: string;
  };

export async function prepareTaskExecution(
  runner: TaskRunner,
  task: TaskState,
  attemptId: string,
  bench: ExecuteTaskBench,
  dispatchOpts?: LaunchDispatchOptions,
): Promise<PreparedTaskExecution> {
  bench('executeTaskInner.begin', {
    dependencyCount: task.dependencies.length,
    externalDependencyCount: task.config.externalDependencies?.length ?? 0,
    runnerKind: task.config.runnerKind,
    poolId: task.config.poolId,
    isMergeNode: task.config.isMergeNode,
  });

  if (task.config.pivot && task.config.experimentVariants && task.config.experimentVariants.length > 0) {
    bench('executeTaskInner.pivotResponse');
    const response: WorkResponse = {
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
    };
    const newlyStarted = runner.orchestrator.handleWorkerResponse(response) ?? [];
    runner.executeNewlyStartedTasks(newlyStarted, dispatchOpts);
    if (dispatchOpts) {
      try {
        dispatchOpts.launchOutbox.completeDispatch(dispatchOpts.dispatchId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[task-runner] pivot completeDispatch failed for dispatchId=${dispatchOpts.dispatchId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    bench('executeTaskInner.pivotReturned', {
      newlyStartedCount: newlyStarted.length,
    });
    return { kind: 'pivot' };
  }

  traceExecution(
    `${RESTART_TO_BRANCH_TRACE} executeTaskInner taskId=${task.id} (past pivot check) -> gather upstreams + build WorkRequest`,
  );

  bench('buildUpstreamContext.start');
  const upstreamContext = await runner.buildUpstreamContext(task);
  bench('buildUpstreamContext.end', {
    upstreamContextCount: upstreamContext.length,
  });
  bench('collectUpstreamBranches.start');
  const upstreamBranches = runner.collectUpstreamBranches(task);
  bench('collectUpstreamBranches.end', {
    upstreamBranchCount: upstreamBranches.length,
  });
  bench('buildAlternatives.start');
  const alternatives = runner.buildAlternatives(task);
  bench('buildAlternatives.end', {
    alternativeCount: alternatives.length,
  });

  if (!task.config.isMergeNode) {
    for (const depId of task.dependencies) {
      const dep = runner.orchestrator.getTask(depId);
      if (dep && dep.status === 'completed' && !dep.execution.branch) {
        throw new Error(
          `Task "${task.id}": dependency "${depId}" completed without branch metadata` +
          ' - upstream changes would be silently dropped. The plan may need to be restarted.',
        );
      }
    }
    for (const depRef of task.config.externalDependencies ?? []) {
      const dep = runner.resolveExternalDependencyTask(depRef.workflowId, depRef.taskId);
      if (dep && dep.status === 'completed' && !dep.execution.branch) {
        throw new Error(
          `Task "${task.id}": external dependency "${depRef.workflowId}/${depRef.taskId}" completed without branch metadata` +
          ' - upstream changes would be silently dropped. The plan may need to be restarted.',
        );
      }
    }
  }
  bench('dependencyBranchGuard.end');

  const workflow = task.config.workflowId ? runner.persistence.loadWorkflow?.(task.config.workflowId) : undefined;
  const workflowGeneration = (workflow as { generation?: number } | undefined)?.generation ?? 0;
  const taskExecutionGeneration = task.execution.generation ?? 0;
  const lifecycleTag = formatLifecycleTag({
    wfGen: workflowGeneration,
    taskGen: taskExecutionGeneration,
    attemptShort: extractAttemptSuffix(attemptId, task.id),
  });
  const baseBranch = workflow?.baseBranch ?? runner.defaultBranch;
  const repoUrl = workflow?.repoUrl;
  const branchRepoUrl = workflow?.intermediateRepoUrl?.trim() || undefined;
  const freshBase = task.config.workflowId ? runner.freshBaseCommits.get(task.config.workflowId) : undefined;
  const baseCommit = freshBase && freshBase.branch === baseBranch ? freshBase.commit : undefined;

  let branchPersistedEarly = false;
  const startGeneration = task.execution.generation ?? 0;
  const onBranchResolved = (branch: string): void => {
    if (!branch || branchPersistedEarly) return;
    if (runner.isLaunchStale(task.id, attemptId, startGeneration)) return;
    branchPersistedEarly = true;
    try {
      runner.persistence.updateAttempt?.(attemptId, { branch } as any);
      runner.persistence.updateTask(task.id, {
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

  const actionType = runner.determineActionType(task);
  const executionAgent = task.config.executionAgent?.trim() || DEFAULT_EXECUTION_AGENT;
  const request: WorkRequest = {
    requestId: randomUUID(),
    actionId: task.id,
    attemptId,
    executionGeneration: task.execution.generation ?? 0,
    actionType,
    inputs: {
      description: task.description,
      command: task.config.command,
      prompt: task.config.prompt,
      executionAgent,
      repoUrl,
      branchRepoUrl,
      featureBranch: task.config.featureBranch,
      upstreamContext: upstreamContext.length > 0 ? upstreamContext : undefined,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      upstreamBranches: upstreamBranches.length > 0 ? upstreamBranches : undefined,
      lifecycleTag,
      baseBranch,
      baseCommit,
      freshWorkspace: runner.shouldUseFreshWorkspace(task),
      reusableWorktree: task.execution.branch && task.execution.workspacePath
        ? {
          branch: task.execution.branch,
          workspacePath: task.execution.workspacePath,
        }
        : undefined,
    },
    callbackUrl: '',
    timestamps: {
      createdAt: new Date().toISOString(),
    },
    onBranchResolved,
  };
  bench('workRequest.built', {
    actionType: request.actionType,
    hasRepoUrl: Boolean(request.inputs.repoUrl),
    upstreamBranchCount: upstreamBranches.length,
  });

  traceExecution(
    `${RESTART_TO_BRANCH_TRACE} executeTaskInner taskId=${task.id} WorkRequest built actionType=${request.actionType} repoUrl=${request.inputs.repoUrl ?? '(none)'} upstreamBranches=${JSON.stringify(request.inputs.upstreamBranches ?? [])}`,
  );

  return {
    kind: 'prepared',
    request,
    actionType,
    executionAgent,
  };
}
