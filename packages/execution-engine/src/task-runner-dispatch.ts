import { randomUUID } from 'node:crypto';
import type { TaskState, RunnerKind } from '@invoker/workflow-core';
import type { ActionType, WorkRequest } from '@invoker/contracts';
import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { Executor, ExecutorHandle } from './executor.js';
import { DEFAULT_EXECUTION_AGENT } from './agent.js';
import { formatLifecycleTag, extractAttemptSuffix } from './branch-utils.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from './exec-trace.js';
import type { LaunchDispatchOptions } from './task-runner.js';
import {
  registerCompletionRouting,
  routePivotResponse,
  updateExecutorHeartbeat,
} from './task-runner-finalize.js';

type StartupFailureMetadata = {
  workspacePath?: string;
  branch?: string;
  agentSessionId?: string;
  containerId?: string;
};

type ActiveExecutionHandle = ExecutorHandle & { attemptId?: string };

const PRE_START_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_EXECUTOR_START_TIMEOUT_MS = 10 * 60 * 1000;

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

function getExecutorStartTimeoutMs(): number {
  const raw = process.env.INVOKER_EXECUTOR_START_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_EXECUTOR_START_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EXECUTOR_START_TIMEOUT_MS;
  return parsed;
}

function isRetryableSshStartupTransportError(err: unknown): boolean {
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  const lower = message.toLowerCase();
  return lower.includes('exit=255')
    || lower.includes('ssh transport failed')
    || lower.includes('connection timed out')
    || lower.includes('operation timed out')
    || lower.includes('connection reset')
    || lower.includes('broken pipe')
    || lower.includes('banner exchange')
    || lower.includes('kex_exchange_identification')
    || lower.includes('remote session terminated unexpectedly');
}

function buildTaskWorkRequest(
  runner: any,
  task: TaskState,
  attemptId: string,
  upstreamContext: any[],
  upstreamBranches: string[],
  alternatives: any[],
  onBranchResolved: (branch: string) => void,
): { request: WorkRequest; actionType: ActionType; executionAgent: string } {
  const workflow = task.config.workflowId ? runner.persistence.loadWorkflow?.(task.config.workflowId) : undefined;
  const workflowGeneration = (workflow as any)?.generation ?? 0;
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
  const actionType = runner.determineActionType(task);
  const executionAgent = task.config.executionAgent?.trim() || DEFAULT_EXECUTION_AGENT;

  return {
    actionType,
    executionAgent,
    request: {
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
    },
  };
}

function createBranchResolvedHandler(
  runner: any,
  task: TaskState,
  attemptId: string,
  startGeneration: number,
): (branch: string) => void {
  let branchPersistedEarly = false;
  return (branch: string): void => {
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
}

async function startExecutorWithRetries(
  runner: any,
  task: TaskState,
  attemptId: string,
  startGeneration: number,
  request: WorkRequest,
  bench: (phase: string, metadata?: Record<string, unknown>) => void,
  dispatchOpts?: LaunchDispatchOptions,
): Promise<{ executor: Executor; handle: ExecutorHandle; startElapsedMs: number }> {
  const startT0 = Date.now();
  const attemptedPoolMemberKeys = new Set<string>();
  let executor!: Executor;
  let handle!: ExecutorHandle;
  while (true) {
    bench('selectExecutor.start');
    executor = runner.selectExecutor(task, attemptedPoolMemberKeys);
    const poolSelectionForStart = runner.pendingPoolSelections.get(task.id);
    if (!runner.acquirePoolSelectionLease(task, attemptId, poolSelectionForStart)) {
      if (poolSelectionForStart) {
        attemptedPoolMemberKeys.add(poolSelectionForStart.memberKey);
        runner.pendingPoolSelections.delete(task.id);
      }
      continue;
    }
    bench('selectExecutor.end', {
      executorType: executor.type,
    });
    traceExecution(
      `${RESTART_TO_BRANCH_TRACE} executeTaskInner taskId=${task.id} selectExecutor → type=${executor.type} calling executor.start()`,
    );
    traceExecution(`[trace] TaskRunner: task=${task.id} calling executor.start() type=${executor.type}`);
    runner.logger.info(
      `[TaskRunner] executor.start begin task=${task.id} attempt=${attemptId} executor=${executor.type} ` +
        `generation=${task.execution.generation ?? 0}`,
    );
    runner.persistence.logEvent?.(task.id, 'task.executor.start_begin', {
      dispatchId: dispatchOpts?.dispatchId,
      attemptId,
      executorType: executor.type,
      poolId: poolSelectionForStart?.poolId,
      poolMemberId: poolSelectionForStart?.member.id,
    });
    bench('onLaunchStart.before', {
      executorType: executor.type,
    });
    runner.callbacks.onLaunchStart?.(task.id, executor);
    bench('executor.start.before', {
      executorType: executor.type,
    });
    const startTimeoutMs = getExecutorStartTimeoutMs();
    const preStartHeartbeatTimer = setInterval(() => {
      const now = new Date();
      runner.renewPoolSelectionLease(poolSelectionForStart);
      runner.persistence.updateAttempt?.(attemptId, {
        lastHeartbeatAt: now,
        leaseExpiresAt: nextLeaseExpiry(now),
      } as any);
      runner.callbacks.onHeartbeat?.(task.id, { at: now, source: 'executor' });
    }, PRE_START_HEARTBEAT_INTERVAL_MS);
    let preStartTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      handle = await Promise.race<ExecutorHandle>([
        executor.start(request),
        new Promise<ExecutorHandle>((_resolve, reject) => {
          preStartTimeout = setTimeout(() => {
            reject(new Error(`Executor startup timed out after ${startTimeoutMs}ms (${executor.type})`));
          }, startTimeoutMs);
        }),
      ]);
      break;
    } catch (err) {
      const meta = err as StartupFailureMetadata;
      if (
        executor.type === 'ssh'
        && poolSelectionForStart?.member.type === 'ssh'
        && !meta.workspacePath
        && !meta.branch
        && isRetryableSshStartupTransportError(err)
      ) {
        attemptedPoolMemberKeys.add(poolSelectionForStart.memberKey);
        const pool = runner.getExecutionPools()[poolSelectionForStart.poolId];
        const hasAnotherSshMember = pool?.members.some((member: any) =>
          member.type === 'ssh' && !attemptedPoolMemberKeys.has(runner.poolMemberKey(member)),
        ) ?? false;
        if (hasAnotherSshMember) {
          const retryMessage =
            `Executor startup failed (${executor.type}) on pool member ${poolSelectionForStart.member.id}; ` +
            `retrying another SSH pool member: ${err instanceof Error ? err.message : String(err)}\n`;
          runner.callbacks.onOutput?.(task.id, retryMessage);
          try {
            runner.persistence.appendTaskOutput(task.id, retryMessage);
          } catch {
            // Preserve the original startup failure if output persistence also fails.
          }
          runner.persistence.logEvent?.(task.id, 'task.executor.startup-retry', {
            runnerKind: executor.type,
            poolId: poolSelectionForStart.poolId,
            poolMemberId: poolSelectionForStart.member.id,
            reason: 'ssh-startup-transport-failure',
            error: err instanceof Error ? err.message : String(err),
          });
          runner.pendingPoolSelections.delete(task.id);
          runner.releasePoolSelectionLease(poolSelectionForStart);
          continue;
        }
      }
      const startupErrorMessage = `Executor startup failed (${executor.type}): ${err instanceof Error ? err.message : String(err)}\n`;
      runner.callbacks.onOutput?.(task.id, startupErrorMessage);
      try {
        runner.persistence.appendTaskOutput(task.id, startupErrorMessage);
      } catch {
        // Preserve the original startup failure if output persistence also fails.
      }
      const launchStale = runner.isLaunchStale(task.id, attemptId, startGeneration);
      if (
        (meta.workspacePath || meta.branch || meta.agentSessionId || meta.containerId)
        && !launchStale
      ) {
        const execution: Record<string, string> = {};
        if (meta.workspacePath) execution.workspacePath = meta.workspacePath;
        if (meta.branch) execution.branch = meta.branch;
        if (meta.agentSessionId) {
          execution.agentSessionId = meta.agentSessionId;
          execution.lastAgentSessionId = meta.agentSessionId;
        }
        if (meta.containerId) execution.containerId = meta.containerId;
        const poolSelection = runner.pendingPoolSelections.get(task.id);
        const selectedSshTargetId = executor.type === 'ssh'
          ? runner.selectedRemoteTargetId(task, poolSelection)
          : undefined;
        runner.persistence.updateTask(task.id, {
          config: {
            runnerKind: executor.type as RunnerKind,
            ...(selectedSshTargetId ? { poolMemberId: selectedSshTargetId } : {}),
          },
          execution: execution as any,
        });
      }
      if (launchStale) {
        runner.persistence.logEvent?.(task.id, 'task.executor.stale_startup_failure', {
          attemptId,
          executorType: executor.type,
          error: err instanceof Error ? err.message : String(err),
          workspacePath: meta.workspacePath,
          branch: meta.branch,
          hasAgentSessionId: Boolean(meta.agentSessionId),
          hasContainerId: Boolean(meta.containerId),
        });
      }
      runner.pendingPoolSelections.delete(task.id);
      runner.releasePoolSelectionLease(poolSelectionForStart);
      const wrapped = new Error(
        `Executor startup failed (${executor.type}): ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
      if (!launchStale) {
        runner.callbacks.onLaunchFailed?.(task.id, wrapped, executor);
      }
      throw wrapped;
    } finally {
      clearInterval(preStartHeartbeatTimer);
      if (preStartTimeout) clearTimeout(preStartTimeout);
    }
  }

  return { executor, handle, startElapsedMs: Date.now() - startT0 };
}

function persistStartMetadata(
  runner: any,
  task: TaskState,
  attemptId: string,
  actionType: ActionType,
  executionAgent: string,
  executor: Executor,
  handle: ExecutorHandle,
  bench: (phase: string, metadata?: Record<string, unknown>) => void,
): void {
  if (!handle.workspacePath) {
    runner.releasePoolSelectionLease(runner.pendingPoolSelections.get(task.id));
    throw new Error(
      `Executor "${executor.type}" did not provide workspacePath for task "${task.id}". ` +
      `All executors must set workspacePath; refusing to fall back to host repo.`,
    );
  }

  runner.logExecutorSelected(
    task,
    executor,
    handle,
    attemptId,
    runner.pendingPoolSelections.get(task.id),
  );

  const poolSelection = runner.pendingPoolSelections.get(task.id);
  const selectedSshTargetId = executor.type === 'ssh'
    ? runner.selectedRemoteTargetId(task, poolSelection)
    : undefined;
  const changes = {
    config: {
      runnerKind: executor.type as RunnerKind,
      ...(selectedSshTargetId ? { poolMemberId: selectedSshTargetId } : {}),
    },
    execution: {
      workspacePath: handle.workspacePath,
      branch: handle.branch ?? undefined,
      agentSessionId: handle.agentSessionId ?? undefined,
      lastAgentSessionId: handle.agentSessionId ?? undefined,
      agentName: actionType === 'ai_task' ? executionAgent : undefined,
      lastAgentName: actionType === 'ai_task' ? executionAgent : undefined,
      containerId: handle.containerId ?? undefined,
    },
  };
  runner.persistence.updateTask(task.id, changes);
  try {
    runner.persistence.updateAttempt?.(attemptId, {
      branch: handle.branch ?? undefined,
      workspacePath: handle.workspacePath,
    } as any);
  } catch (err) {
    traceExecution(
      `${RESTART_TO_BRANCH_TRACE} task=${task.id} attempt=${attemptId} post-start attempt persist failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  traceExecution(
    `[agent-session-trace] TaskRunner.persistStartMetadata task=${task.id} agentSessionId=${handle.agentSessionId ?? 'null'}`,
  );
  if (task.config.isMergeNode) {
    traceExecution(
      `[merge-gate-workspace] persistStartMetadata mergeNode=${task.id} ` +
        `executor workspacePath=${changes.execution.workspacePath} ` +
        '(gate clone path is written later in executeMergeNode)',
    );
  }
  traceExecution(`[trace] TaskRunner: persisted metadata for task=${task.id} workspacePath=${handle.workspacePath} branch=${handle.branch ?? 'null'}`);
  bench('persistStartMetadata.end', {
    workspacePath: handle.workspacePath,
    branch: handle.branch ?? undefined,
  });
}

function registerActiveExecution(
  runner: any,
  task: TaskState,
  attemptId: string,
  executor: Executor,
  handle: ExecutorHandle,
  bench: (phase: string, metadata?: Record<string, unknown>) => void,
): void {
  const activeHandle = handle as ActiveExecutionHandle;
  activeHandle.attemptId = attemptId;
  const poolSelection = runner.pendingPoolSelections.get(task.id);
  runner.pendingPoolSelections.delete(task.id);
  runner.activeExecutions.set(attemptId, {
    handle: activeHandle,
    executor,
    taskId: task.id,
    poolId: poolSelection?.poolId,
    poolMemberKey: poolSelection?.memberKey,
    leaseResourceKey: poolSelection?.leaseResourceKey,
    leaseHolderId: poolSelection?.leaseHolderId,
  });
  runner.logger.info(
    `[TaskRunner] active execution registered task=${task.id} attempt=${attemptId} ` +
      `executor=${executor.type} executionId=${handle.executionId} activeExecutions=${runner.activeExecutions.size}`,
  );
  bench('onSpawned.before');
  runner.callbacks.onSpawned?.(task.id, handle, executor);
  bench('onSpawned.after');
}

export async function dispatchTaskExecution(
  runner: any,
  task: TaskState,
  attemptId: string,
  bench: (phase: string, metadata?: Record<string, unknown>) => void = () => {},
  dispatchOpts?: LaunchDispatchOptions,
): Promise<void> {
  bench('executeTaskInner.begin', {
    dependencyCount: task.dependencies.length,
    externalDependencyCount: task.config.externalDependencies?.length ?? 0,
    runnerKind: task.config.runnerKind,
    poolId: task.config.poolId,
    isMergeNode: task.config.isMergeNode,
  });

  if (task.config.pivot && task.config.experimentVariants && task.config.experimentVariants.length > 0) {
    bench('executeTaskInner.pivotResponse');
    routePivotResponse(runner, task, attemptId, dispatchOpts);
    bench('executeTaskInner.pivotReturned');
    return;
  }

  traceExecution(
    `${RESTART_TO_BRANCH_TRACE} executeTaskInner taskId=${task.id} (past pivot check) → gather upstreams + build WorkRequest`,
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
          ` — upstream changes would be silently dropped. The plan may need to be restarted.`,
        );
      }
    }
    for (const depRef of task.config.externalDependencies ?? []) {
      const dep = runner.resolveExternalDependencyTask(depRef.workflowId, depRef.taskId);
      if (dep && dep.status === 'completed' && !dep.execution.branch) {
        throw new Error(
          `Task "${task.id}": external dependency "${depRef.workflowId}/${depRef.taskId}" completed without branch metadata` +
          ` — upstream changes would be silently dropped. The plan may need to be restarted.`,
        );
      }
    }
  }
  bench('dependencyBranchGuard.end');

  const startGeneration = task.execution.generation ?? 0;
  const onBranchResolved = createBranchResolvedHandler(runner, task, attemptId, startGeneration);
  const { request, actionType, executionAgent } = buildTaskWorkRequest(
    runner,
    task,
    attemptId,
    upstreamContext,
    upstreamBranches,
    alternatives,
    onBranchResolved,
  );
  bench('workRequest.built', {
    actionType: request.actionType,
    hasRepoUrl: Boolean(request.inputs.repoUrl),
    upstreamBranchCount: upstreamBranches.length,
  });

  traceExecution(
    `${RESTART_TO_BRANCH_TRACE} executeTaskInner taskId=${task.id} WorkRequest built actionType=${request.actionType} repoUrl=${request.inputs.repoUrl ?? '(none)'} upstreamBranches=${JSON.stringify(request.inputs.upstreamBranches ?? [])}`,
  );

  const { executor, handle, startElapsedMs } = await startExecutorWithRetries(
    runner,
    task,
    attemptId,
    startGeneration,
    request,
    bench,
    dispatchOpts,
  );
  traceExecution(`[trace] TaskRunner: task=${task.id} executor.start() returned after ${startElapsedMs}ms executor=${executor.type} sessionId=${handle.agentSessionId ?? 'none'} workspace=${handle.workspacePath ?? 'default'}`);
  runner.logger.info(
    `[TaskRunner] executor.start returned task=${task.id} attempt=${attemptId} executor=${executor.type} ` +
      `elapsedMs=${startElapsedMs} executionId=${handle.executionId} ` +
      `workspace=${handle.workspacePath ?? 'none'} branch=${handle.branch ?? 'none'} ` +
      `agentSessionId=${handle.agentSessionId ?? 'none'}`,
  );
  bench('executor.start.after', {
    executorType: executor.type,
    executorStartMs: startElapsedMs,
    hasWorkspacePath: Boolean(handle.workspacePath),
    hasAgentSessionId: Boolean(handle.agentSessionId),
  });

  const launchAccepted =
    runner.orchestrator.markTaskRunningAfterLaunch?.(task.id, attemptId) ?? true;
  if (!launchAccepted) {
    runner.logger.warn(
      `[TaskRunner] launch rejected as stale/non-executable for task=${task.id} attemptId=${attemptId}; killing spawned process`,
    );
    try {
      await executor.kill(handle);
    } catch (killErr) {
      runner.logger.warn(`[TaskRunner] failed to kill rejected launch for task=${task.id}`, { killErr });
    }
    runner.releasePoolSelectionLease(runner.pendingPoolSelections.get(task.id));
    runner.pendingPoolSelections.delete(task.id);
    await runner.cleanupPerTaskDockerExecutor(task);
    if (dispatchOpts) {
      dispatchOpts.launchOutbox.failDispatch(
        dispatchOpts.dispatchId,
        new Error('Launch rejected as stale or non-executable after executor start'),
      );
    }
    bench('markTaskRunningAfterLaunch.rejected');
    return;
  }
  bench('markTaskRunningAfterLaunch.accepted');

  persistStartMetadata(runner, task, attemptId, actionType, executionAgent, executor, handle, bench);
  registerActiveExecution(runner, task, attemptId, executor, handle, bench);

  executor.onOutput(handle, (data) => {
    runner.callbacks.onOutput?.(task.id, data);
  });

  executor.onHeartbeat(handle, () => {
    updateExecutorHeartbeat(runner, task, attemptId, executor, handle);
  });

  const completionPromise = registerCompletionRouting(
    runner,
    task,
    attemptId,
    executor,
    handle,
    dispatchOpts,
  );
  if (dispatchOpts) {
    dispatchOpts.launchOutbox.completeDispatch(dispatchOpts.dispatchId);
  }
  return completionPromise;
}

