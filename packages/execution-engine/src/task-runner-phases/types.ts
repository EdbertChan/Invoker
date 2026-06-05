import type { Executor, ExecutorHandle } from '../executor.js';

export type StartupFailureMetadata = {
  workspacePath?: string;
  branch?: string;
  agentSessionId?: string;
  containerId?: string;
};

export type ActiveExecutionHandle = ExecutorHandle & { attemptId?: string };

export type ActiveExecutionEntry = {
  handle: ActiveExecutionHandle;
  executor: Executor;
  taskId: string;
  poolId?: string;
  poolMemberKey?: string;
  leaseResourceKey?: string;
  leaseHolderId?: string;
};

export type ExecutionPoolMember =
  | { type: 'ssh'; id: string; maxConcurrentTasks?: number }
  | { type: 'worktree'; id: string; maxConcurrentTasks?: number };

export type ExecutionPoolConfig = {
  members: ExecutionPoolMember[];
  selectionStrategy?: 'roundRobin' | 'leastLoaded';
  maxConcurrentTasksPerMember?: number;
};

export type PoolSelection = {
  poolId: string;
  member: ExecutionPoolMember;
  memberKey: string;
  selectionStrategy: 'roundRobin' | 'leastLoaded';
  leaseResourceKey?: string;
  leaseHolderId?: string;
};

export type FreshBaseCommit = {
  branch: string;
  commit: string;
};

export type RemoteTargetDisplay = {
  host: string;
  user: string;
  sshKeyPath: string;
  port?: number;
  managedWorkspaces?: boolean;
  remoteInvokerHome?: string;
  provisionCommand?: string;
  use_api_key?: boolean;
  secretsFile?: string;
  remoteHeartbeatIntervalSeconds?: number;
};

export interface LaunchOutboxAck {
  ackDispatch(dispatchId: number, runnerId: string): boolean;
  completeDispatch(dispatchId: number): boolean;
  failDispatch(dispatchId: number, error: unknown): boolean;
}

export interface LaunchDispatchOptions {
  dispatchId: number;
  launchOutbox: LaunchOutboxAck;
}

export type ExecuteTaskBench = (phase: string, metadata?: Record<string, unknown>) => void;
