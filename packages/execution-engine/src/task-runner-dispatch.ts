import type { RunnerKind, TaskState } from '@invoker/workflow-core';
import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { Executor, ExecutorHandle } from './executor.js';

import type {
  ActiveExecutionHandle,
  LaunchDispatchOptions,
  TaskRunner,
} from './task-runner.js';
import type { ExecuteTaskBench, PreparedTaskExecution } from './task-runner-prepare.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from './exec-trace.js';
import { createTaskCompletionPromise } from './task-runner-finalize.js';

const PRE_START_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_EXECUTOR_START_TIMEOUT_MS = 10 * 60 * 1000;

type StartupFailureMetadata = {
  workspacePath?: string;
  branch?: string;
  agentSessionId?: string;
  containerId?: string;
};

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

export async function dispatchTaskExecution(
  runner: TaskRunner,
  task: TaskState,
  attemptId: string,
  prepared: Extract<PreparedTaskExecution, { kind: 'prepared' }>,
  bench: ExecuteTaskBench,
  dispatchOpts?: LaunchDispatchOptions,
): Promise<void> {
  const { request, actionType, executionAgent } = prepared;
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
      `${RESTART_TO_BRANCH_TRACE} executeTaskInner taskId=${task.id} selectExecutor -> type=${executor.type} calling executor.start()`,
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
        const hasAnotherSshMember = pool?.members.some((member) =>
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
      const startGeneration = task.execution.generation ?? 0;
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

  traceExecution(`[trace] TaskRunner: task=${task.id} executor.start() returned after ${Date.now() - startT0}ms executor=${executor.type} sessionId=${handle.agentSessionId ?? 'none'} workspace=${handle.workspacePath ?? 'default'}`);
  runner.logger.info(
    `[TaskRunner] executor.start returned task=${task.id} attempt=${attemptId} executor=${executor.type} ` +
      `elapsedMs=${Date.now() - startT0} executionId=${handle.executionId} ` +
      `workspace=${handle.workspacePath ?? 'none'} branch=${handle.branch ?? 'none'} ` +
      `agentSessionId=${handle.agentSessionId ?? 'none'}`,
  );
  bench('executor.start.after', {
    executorType: executor.type,
    executorStartMs: Date.now() - startT0,
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

  if (!handle.workspacePath) {
    runner.releasePoolSelectionLease(runner.pendingPoolSelections.get(task.id));
    throw new Error(
      `Executor "${executor.type}" did not provide workspacePath for task "${task.id}". ` +
      'All executors must set workspacePath; refusing to fall back to host repo.',
    );
  }

  runner.logExecutorSelected(
    task,
    executor,
    handle,
    attemptId,
    runner.pendingPoolSelections.get(task.id),
  );

  const poolSelectionForMetadata = runner.pendingPoolSelections.get(task.id);
  const selectedSshTargetId = executor.type === 'ssh'
    ? runner.selectedRemoteTargetId(task, poolSelectionForMetadata)
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

  executor.onOutput(handle, (data) => {
    runner.callbacks.onOutput?.(task.id, data);
  });

  executor.onHeartbeat(handle, () => {
    const now = new Date();
    const isRemoteWorkloadHeartbeat = executor.type === 'ssh';
    if (isRemoteWorkloadHeartbeat) {
      runner.logger.info(
        `[TaskRunner] ssh heartbeat received task=${task.id} attempt=${attemptId} executionId=${handle.executionId} ` +
          `at=${now.toISOString()}`,
      );
    }
    const activeLease = runner.activeExecutions.get(attemptId);
    if (activeLease?.leaseResourceKey && activeLease.leaseHolderId) {
      runner.persistence.renewExecutionResourceLease?.(activeLease.leaseResourceKey, activeLease.leaseHolderId);
    }
    runner.persistence.updateAttempt?.(attemptId, {
      lastHeartbeatAt: now,
      leaseExpiresAt: nextLeaseExpiry(now),
    } as any);
    runner.callbacks.onHeartbeat?.(task.id, {
      at: now,
      source: isRemoteWorkloadHeartbeat ? 'remote_workload' : 'executor',
    });
  });

  const completionPromise = createTaskCompletionPromise(
    runner,
    task,
    attemptId,
    handle,
    executor,
    dispatchOpts,
  );
  if (dispatchOpts) {
    dispatchOpts.launchOutbox.completeDispatch(dispatchOpts.dispatchId);
  }
  return completionPromise;
}
