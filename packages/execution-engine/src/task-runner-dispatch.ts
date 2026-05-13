import type { TaskState, ExecutorType } from '@invoker/workflow-core';
import type { Logger } from '@invoker/contracts';
import type { Executor, ExecutorHandle } from './executor.js';
import type { TaskRunnerCallbacks } from './task-runner.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from './exec-trace.js';

const PRE_START_HEARTBEAT_INTERVAL_MS = 30_000;
const ATTEMPT_LEASE_MS = 20 * 60 * 1000;
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

export interface TaskRunnerDispatchHost {
  callbacks: TaskRunnerCallbacks;
  logger: Logger;
  persistence: {
    appendTaskOutput: (taskId: string, data: string) => void;
    updateAttempt?: (attemptId: string, changes: any) => void;
    updateTask: (taskId: string, changes: any) => void;
  };
  orchestrator: {
    markTaskRunningAfterLaunch?: (taskId: string, attemptId: string) => boolean;
  };
  isLaunchStale(taskId: string, attemptId: string, startGeneration: number): boolean;
  cleanupPerTaskDockerExecutor(task: TaskState): Promise<void>;
  registerActiveExecution(attemptId: string, taskId: string, handle: ExecutorHandle, executor: Executor): void;
}

export async function dispatchTaskExecution(
  host: TaskRunnerDispatchHost,
  task: TaskState,
  attemptId: string,
  executor: Executor,
  request: Parameters<Executor['start']>[0],
): Promise<ExecutorHandle | undefined> {
  traceExecution(`[trace] TaskRunner: task=${task.id} calling executor.start() type=${executor.type}`);
  host.callbacks.onLaunchStart?.(task.id, executor);
  const startT0 = Date.now();
  const startTimeoutMs = getExecutorStartTimeoutMs();
  const preStartHeartbeatTimer = setInterval(() => {
    const now = new Date();
    host.persistence.updateAttempt?.(attemptId, {
      lastHeartbeatAt: now,
      leaseExpiresAt: nextLeaseExpiry(now),
    } as any);
    host.callbacks.onHeartbeat?.(task.id);
  }, PRE_START_HEARTBEAT_INTERVAL_MS);
  let preStartTimeout: ReturnType<typeof setTimeout> | undefined;
  let handle: ExecutorHandle;
  try {
    handle = await Promise.race<ExecutorHandle>([
      executor.start(request),
      new Promise<ExecutorHandle>((_resolve, reject) => {
        preStartTimeout = setTimeout(() => {
          reject(new Error(`Executor startup timed out after ${startTimeoutMs}ms (${executor.type})`));
        }, startTimeoutMs);
      }),
    ]);
  } catch (err) {
    const meta = err as StartupFailureMetadata;
    const startupErrorMessage = `Executor startup failed (${executor.type}): ${err instanceof Error ? err.message : String(err)}\n`;
    host.callbacks.onOutput?.(task.id, startupErrorMessage);
    try {
      host.persistence.appendTaskOutput(task.id, startupErrorMessage);
    } catch {
      // Preserve the original startup failure if output persistence also fails.
    }
    if (
      (meta.workspacePath || meta.branch || meta.agentSessionId || meta.containerId)
      && !host.isLaunchStale(task.id, attemptId, task.execution.generation ?? 0)
    ) {
      const execution: Record<string, string> = {};
      if (meta.workspacePath) execution.workspacePath = meta.workspacePath;
      if (meta.branch) execution.branch = meta.branch;
      if (meta.agentSessionId) {
        execution.agentSessionId = meta.agentSessionId;
        execution.lastAgentSessionId = meta.agentSessionId;
      }
      if (meta.containerId) execution.containerId = meta.containerId;
      host.persistence.updateTask(task.id, {
        config: { executorType: executor.type as ExecutorType },
        execution: execution as any,
      });
    }
    const wrapped = new Error(
      `Executor startup failed (${executor.type}): ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
    host.callbacks.onLaunchFailed?.(task.id, wrapped, executor);
    throw wrapped;
  } finally {
    clearInterval(preStartHeartbeatTimer);
    if (preStartTimeout) clearTimeout(preStartTimeout);
  }
  traceExecution(`[trace] TaskRunner: task=${task.id} executor.start() returned after ${Date.now() - startT0}ms executor=${executor.type} sessionId=${handle.agentSessionId ?? 'none'} workspace=${handle.workspacePath ?? 'default'}`);
  const launchAccepted =
    host.orchestrator.markTaskRunningAfterLaunch?.(task.id, attemptId) ?? true;
  if (!launchAccepted) {
    host.logger.warn(
      `[TaskRunner] launch rejected as stale/non-executable for task=${task.id} attemptId=${attemptId}; killing spawned process`,
    );
    try {
      await executor.kill(handle);
    } catch (killErr) {
      host.logger.warn(`[TaskRunner] failed to kill rejected launch for task=${task.id}`, { killErr });
    }
    await host.cleanupPerTaskDockerExecutor(task);
    return undefined;
  }

  if (!handle.workspacePath) {
    throw new Error(
      `Executor "${executor.type}" did not provide workspacePath for task "${task.id}". ` +
      `All executors must set workspacePath; refusing to fall back to host repo.`,
    );
  }

  const changes = {
    config: { executorType: executor.type as ExecutorType },
    execution: {
      workspacePath: handle.workspacePath,
      branch: handle.branch ?? undefined,
      agentSessionId: handle.agentSessionId ?? undefined,
      lastAgentSessionId: handle.agentSessionId ?? undefined,
      lastAgentName: task.execution.agentName ?? undefined,
      containerId: handle.containerId ?? undefined,
    },
  };
  host.persistence.updateTask(task.id, changes);
  try {
    host.persistence.updateAttempt?.(attemptId, {
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

  host.registerActiveExecution(attemptId, task.id, handle, executor);
  host.callbacks.onSpawned?.(task.id, handle, executor);

  executor.onOutput(handle, (data) => {
    host.callbacks.onOutput?.(task.id, data);
  });

  executor.onHeartbeat(handle, () => {
    const now = new Date();
    host.persistence.updateAttempt?.(attemptId, {
      lastHeartbeatAt: now,
      leaseExpiresAt: nextLeaseExpiry(now),
    } as any);
    host.callbacks.onHeartbeat?.(task.id);
  });

  return handle;
}
