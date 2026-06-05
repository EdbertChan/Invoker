import type { SQLiteAdapter } from '@invoker/data-store';
import type { Logger, WorkRequest } from '@invoker/contracts';
import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { RunnerKind, TaskState } from '@invoker/workflow-core';
import type { Executor, ExecutorHandle } from '../executor.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from '../exec-trace.js';
import type { TaskRunnerCallbacks } from '../task-runner-callbacks.js';
import type {
  ExecuteTaskBench,
  ExecutionPoolConfig,
  LaunchDispatchOptions,
  PoolSelection,
} from './types.js';

export const PRE_START_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_EXECUTOR_START_TIMEOUT_MS = 10 * 60 * 1000;

export function nextLeaseExpiry(from: Date): Date {
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

export async function startExecutorForTask(args: {
  task: TaskState;
  attemptId: string;
  request: WorkRequest;
  selectExecutor: (task: TaskState, excludedPoolMemberKeys?: Set<string>) => Executor;
  pendingPoolSelections: Map<string, PoolSelection>;
  acquirePoolSelectionLease: (task: TaskState, attemptId: string, selection: PoolSelection | undefined) => boolean;
  renewPoolSelectionLease: (selection: PoolSelection | undefined) => void;
  releasePoolSelectionLease: (selection: PoolSelection | undefined) => void;
  getExecutionPools: () => Record<string, ExecutionPoolConfig>;
  poolMemberKey: (member: { type: string; id: string }) => string;
  isLaunchStale: (taskId: string, attemptId: string, startGeneration: number) => boolean;
  selectedRemoteTargetId: (task: TaskState, poolSelection: PoolSelection | undefined) => string | undefined;
  persistence: SQLiteAdapter;
  callbacks: TaskRunnerCallbacks;
  logger: Logger;
  bench: ExecuteTaskBench;
}): Promise<{ executor: Executor; handle: ExecutorHandle; startMs: number }> {
  const {
    task,
    attemptId,
    request,
    selectExecutor,
    pendingPoolSelections,
    acquirePoolSelectionLease,
    renewPoolSelectionLease,
    releasePoolSelectionLease,
    getExecutionPools,
    poolMemberKey,
    isLaunchStale,
    selectedRemoteTargetId,
    persistence,
    callbacks,
    logger,
    bench,
  } = args;

  const startT0 = Date.now();
  const attemptedPoolMemberKeys = new Set<string>();
  let executor!: Executor;
  let handle!: ExecutorHandle;

  while (true) {
    bench('selectExecutor.start');
    executor = selectExecutor(task, attemptedPoolMemberKeys);
    const poolSelectionForStart = pendingPoolSelections.get(task.id);
    if (!acquirePoolSelectionLease(task, attemptId, poolSelectionForStart)) {
      if (poolSelectionForStart) {
        attemptedPoolMemberKeys.add(poolSelectionForStart.memberKey);
        pendingPoolSelections.delete(task.id);
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
    logger.info(
      `[TaskRunner] executor.start begin task=${task.id} attempt=${attemptId} executor=${executor.type} ` +
        `generation=${task.execution.generation ?? 0}`,
    );
    bench('onLaunchStart.before', {
      executorType: executor.type,
    });
    callbacks.onLaunchStart?.(task.id, executor);
    bench('executor.start.before', {
      executorType: executor.type,
    });
    const startTimeoutMs = getExecutorStartTimeoutMs();
    const preStartHeartbeatTimer = setInterval(() => {
      const now = new Date();
      renewPoolSelectionLease(poolSelectionForStart);
      persistence.updateAttempt?.(attemptId, {
        lastHeartbeatAt: now,
        leaseExpiresAt: nextLeaseExpiry(now),
      } as any);
      callbacks.onHeartbeat?.(task.id, { at: now, source: 'executor' });
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
      const meta = err as {
        workspacePath?: string;
        branch?: string;
        agentSessionId?: string;
        containerId?: string;
      };
      if (
        executor.type === 'ssh'
        && poolSelectionForStart?.member.type === 'ssh'
        && !meta.workspacePath
        && !meta.branch
        && isRetryableSshStartupTransportError(err)
      ) {
        attemptedPoolMemberKeys.add(poolSelectionForStart.memberKey);
        const pool = getExecutionPools()[poolSelectionForStart.poolId];
        const hasAnotherSshMember = pool?.members.some((member) =>
          member.type === 'ssh' && !attemptedPoolMemberKeys.has(poolMemberKey(member)),
        ) ?? false;
        if (hasAnotherSshMember) {
          const retryMessage =
            `Executor startup failed (${executor.type}) on pool member ${poolSelectionForStart.member.id}; ` +
            `retrying another SSH pool member: ${err instanceof Error ? err.message : String(err)}\n`;
          callbacks.onOutput?.(task.id, retryMessage);
          try {
            persistence.appendTaskOutput(task.id, retryMessage);
          } catch {
            // Preserve the original startup failure if output persistence also fails.
          }
          persistence.logEvent?.(task.id, 'task.executor.startup-retry', {
            runnerKind: executor.type,
            poolId: poolSelectionForStart.poolId,
            poolMemberId: poolSelectionForStart.member.id,
            reason: 'ssh-startup-transport-failure',
            error: err instanceof Error ? err.message : String(err),
          });
          pendingPoolSelections.delete(task.id);
          releasePoolSelectionLease(poolSelectionForStart);
          continue;
        }
      }
      const startupErrorMessage = `Executor startup failed (${executor.type}): ${err instanceof Error ? err.message : String(err)}\n`;
      callbacks.onOutput?.(task.id, startupErrorMessage);
      try {
        persistence.appendTaskOutput(task.id, startupErrorMessage);
      } catch {
        // Preserve the original startup failure if output persistence also fails.
      }
      if (
        (meta.workspacePath || meta.branch || meta.agentSessionId || meta.containerId)
        && !isLaunchStale(task.id, attemptId, task.execution.generation ?? 0)
      ) {
        const execution: Record<string, string> = {};
        if (meta.workspacePath) execution.workspacePath = meta.workspacePath;
        if (meta.branch) execution.branch = meta.branch;
        if (meta.agentSessionId) {
          execution.agentSessionId = meta.agentSessionId;
          execution.lastAgentSessionId = meta.agentSessionId;
        }
        if (meta.containerId) execution.containerId = meta.containerId;
        const poolSelection = pendingPoolSelections.get(task.id);
        const selectedSshTargetId = executor.type === 'ssh'
          ? selectedRemoteTargetId(task, poolSelection)
          : undefined;
        persistence.updateTask(task.id, {
          config: {
            runnerKind: executor.type as RunnerKind,
            ...(selectedSshTargetId ? { poolMemberId: selectedSshTargetId } : {}),
          },
          execution: execution as any,
        });
      }
      pendingPoolSelections.delete(task.id);
      releasePoolSelectionLease(poolSelectionForStart);
      const wrapped = new Error(
        `Executor startup failed (${executor.type}): ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
      callbacks.onLaunchFailed?.(task.id, wrapped, executor);
      throw wrapped;
    } finally {
      clearInterval(preStartHeartbeatTimer);
      if (preStartTimeout) clearTimeout(preStartTimeout);
    }
  }

  return { executor, handle, startMs: Date.now() - startT0 };
}
