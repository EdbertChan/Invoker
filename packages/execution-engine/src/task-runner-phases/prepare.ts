import { randomUUID } from 'node:crypto';

import type { SQLiteAdapter } from '@invoker/data-store';
import type { WorkRequest, WorkResponse, ActionType, Logger } from '@invoker/contracts';
import type { Orchestrator, TaskState, ExperimentVariant } from '@invoker/workflow-core';
import { formatLifecycleTag, extractAttemptSuffix } from '../branch-utils.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from '../exec-trace.js';
import { DEFAULT_EXECUTION_AGENT } from '../agent.js';
import type { TaskRunnerCallbacks } from '../task-runner-callbacks.js';
import type {
  ActiveExecutionEntry,
  ExecuteTaskBench,
  FreshBaseCommit,
  LaunchDispatchOptions,
} from './types.js';

export function beginExecuteTaskLaunch(args: {
  task: TaskState;
  attemptId: string;
  startGeneration: number;
  dispatchOpts?: LaunchDispatchOptions;
  launchingAttemptIds: Set<string>;
  activeExecutions: Map<string, ActiveExecutionEntry>;
  runnerInstanceId: string;
  callbacks: TaskRunnerCallbacks;
  logger: Logger;
  bench: ExecuteTaskBench;
}): boolean {
  const {
    task,
    attemptId,
    startGeneration,
    dispatchOpts,
    launchingAttemptIds,
    activeExecutions,
    runnerInstanceId,
    callbacks,
    logger,
    bench,
  } = args;

  if (launchingAttemptIds.has(attemptId) || activeExecutions.has(attemptId)) {
    traceExecution(
      `[TaskRunner] executeTask skipping duplicate launch for task=${task.id} attempt=${attemptId}`,
    );
    bench('executeTask.duplicateSkipped');
    if (dispatchOpts) {
      dispatchOpts.launchOutbox.failDispatch(
        dispatchOpts.dispatchId,
        new Error('Duplicate launch suppressed in TaskRunner'),
      );
    }
    return false;
  }

  if (dispatchOpts) {
    const accepted = dispatchOpts.launchOutbox.ackDispatch(
      dispatchOpts.dispatchId,
      runnerInstanceId,
    );
    if (!accepted) {
      logger.warn(
        `[TaskRunner] launch dispatch ack rejected (lease reaped?) for task=${task.id} attempt=${attemptId} dispatchId=${dispatchOpts.dispatchId}`,
      );
      bench('executeTask.dispatchAckRejected');
      return false;
    }
  }

  logger.info(
    `[TaskRunner] launch accepted task=${task.id} attempt=${attemptId} status=${task.status} ` +
      `phase=${task.execution.phase ?? 'none'} generation=${startGeneration} ` +
      `dispatchId=${dispatchOpts?.dispatchId ?? 'none'}`,
  );
  launchingAttemptIds.add(attemptId);
  callbacks.onLaunchAccepted?.(task.id);
  return true;
}

export function handlePivotTask(args: {
  task: TaskState;
  attemptId: string;
  dispatchOpts?: LaunchDispatchOptions;
  orchestrator: Orchestrator;
  executeNewlyStartedTasks: (tasks: TaskState[], dispatchOpts?: LaunchDispatchOptions) => void;
  bench: ExecuteTaskBench;
}): boolean {
  const { task, attemptId, dispatchOpts, orchestrator, executeNewlyStartedTasks, bench } = args;
  if (!task.config.pivot || !task.config.experimentVariants || task.config.experimentVariants.length === 0) {
    return false;
  }

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
  const newlyStarted = orchestrator.handleWorkerResponse(response) ?? [];
  executeNewlyStartedTasks(newlyStarted, dispatchOpts);
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
  return true;
}

export async function prepareWorkRequest(args: {
  task: TaskState;
  attemptId: string;
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  defaultBranch?: string;
  freshBaseCommits: Map<string, FreshBaseCommit>;
  buildUpstreamContext: (task: TaskState) => Promise<Array<{taskId: string; description: string; summary?: string; commitHash?: string; commitMessage?: string}>>;
  collectUpstreamBranches: (task: TaskState) => string[];
  buildAlternatives: (task: TaskState) => Array<{taskId: string; description: string; branch?: string; commitHash?: string; status: 'completed' | 'failed'; exitCode?: number; summary?: string; selected?: boolean}>;
  resolveExternalDependencyTask: (workflowId: string, taskId?: string) => TaskState | undefined;
  determineActionType: (task: TaskState) => ActionType;
  shouldUseFreshWorkspace: (task: TaskState) => boolean;
  isLaunchStale: (taskId: string, attemptId: string, startGeneration: number) => boolean;
  bench: ExecuteTaskBench;
}): Promise<{
  request: WorkRequest;
  actionType: ActionType;
  executionAgent: string;
  upstreamBranches: string[];
}> {
  const {
    task,
    attemptId,
    orchestrator,
    persistence,
    defaultBranch,
    freshBaseCommits,
    buildUpstreamContext,
    collectUpstreamBranches,
    buildAlternatives,
    resolveExternalDependencyTask,
    determineActionType,
    shouldUseFreshWorkspace,
    isLaunchStale,
    bench,
  } = args;

  bench('buildUpstreamContext.start');
  const upstreamContext = await buildUpstreamContext(task);
  bench('buildUpstreamContext.end', {
    upstreamContextCount: upstreamContext.length,
  });
  bench('collectUpstreamBranches.start');
  const upstreamBranches = collectUpstreamBranches(task);
  bench('collectUpstreamBranches.end', {
    upstreamBranchCount: upstreamBranches.length,
  });
  bench('buildAlternatives.start');
  const alternatives = buildAlternatives(task);
  bench('buildAlternatives.end', {
    alternativeCount: alternatives.length,
  });

  if (!task.config.isMergeNode) {
    for (const depId of task.dependencies) {
      const dep = orchestrator.getTask(depId);
      if (dep && dep.status === 'completed' && !dep.execution.branch) {
        throw new Error(
          `Task "${task.id}": dependency "${depId}" completed without branch metadata` +
          ` — upstream changes would be silently dropped. The plan may need to be restarted.`,
        );
      }
    }
    for (const depRef of task.config.externalDependencies ?? []) {
      const dep = resolveExternalDependencyTask(depRef.workflowId, depRef.taskId);
      if (dep && dep.status === 'completed' && !dep.execution.branch) {
        throw new Error(
          `Task "${task.id}": external dependency "${depRef.workflowId}/${depRef.taskId}" completed without branch metadata` +
          ` — upstream changes would be silently dropped. The plan may need to be restarted.`,
        );
      }
    }
  }
  bench('dependencyBranchGuard.end');

  const workflow = task.config.workflowId ? persistence.loadWorkflow?.(task.config.workflowId) : undefined;
  const workflowGeneration = (workflow as any)?.generation ?? 0;
  const taskExecutionGeneration = task.execution.generation ?? 0;
  const lifecycleTag = formatLifecycleTag({
    wfGen: workflowGeneration,
    taskGen: taskExecutionGeneration,
    attemptShort: extractAttemptSuffix(attemptId, task.id),
  });
  const baseBranch = workflow?.baseBranch ?? defaultBranch;
  const repoUrl = workflow?.repoUrl;
  const branchRepoUrl = workflow?.intermediateRepoUrl?.trim() || undefined;
  const freshBase = task.config.workflowId ? freshBaseCommits.get(task.config.workflowId) : undefined;
  const baseCommit = freshBase && freshBase.branch === baseBranch ? freshBase.commit : undefined;

  let branchPersistedEarly = false;
  const startGeneration = task.execution.generation ?? 0;
  const onBranchResolved = (branch: string): void => {
    if (!branch || branchPersistedEarly) return;
    if (isLaunchStale(task.id, attemptId, startGeneration)) return;
    branchPersistedEarly = true;
    try {
      persistence.updateAttempt?.(attemptId, { branch } as any);
      persistence.updateTask(task.id, {
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

  const actionType = determineActionType(task);
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
      freshWorkspace: shouldUseFreshWorkspace(task),
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

  return { request, actionType, executionAgent, upstreamBranches };
}
