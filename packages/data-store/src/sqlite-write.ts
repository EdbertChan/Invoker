import type { Attempt, TaskStateChanges } from '@invoker/workflow-core';
import type { Workflow } from './adapter.js';
import type { NativeDatabaseCompat } from './sqlite-native.js';

export interface SQLiteWriteContext {
  db: NativeDatabaseCompat;
  isReadOnly(): boolean;
  getTransactionDepth(): number;
  setTransactionDepth(depth: number): void;
  markDirty(): void;
}

export interface SQLiteUpdateParts {
  setClauses: string[];
  values: unknown[];
}

export function ensureSQLiteWritable(ctx: SQLiteWriteContext): void {
  if (ctx.isReadOnly()) {
    throw new Error('SQLiteAdapter is read-only in this process');
  }
}

export function execSQLiteRun(ctx: SQLiteWriteContext, sql: string, params: unknown[] = []): void {
  ensureSQLiteWritable(ctx);
  ctx.db.run(sql, params as any[]);
  ctx.markDirty();
}

export function runSQLiteTransaction<T>(ctx: SQLiteWriteContext, work: () => T): T {
  ensureSQLiteWritable(ctx);
  const depth = ctx.getTransactionDepth();
  ctx.db.run(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT invoker_nested_${depth}`);
  ctx.setTransactionDepth(depth + 1);
  try {
    const result = work();
    const nextDepth = ctx.getTransactionDepth() - 1;
    ctx.setTransactionDepth(nextDepth);
    ctx.db.run(nextDepth === 0 ? 'COMMIT' : `RELEASE invoker_nested_${nextDepth}`);
    ctx.markDirty();
    return result;
  } catch (err) {
    const nextDepth = Math.max(0, ctx.getTransactionDepth() - 1);
    ctx.setTransactionDepth(nextDepth);
    try {
      ctx.db.run(nextDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO invoker_nested_${nextDepth}`);
    } catch {
      // Preserve the original statement failure if SQLite already aborted the
      // transaction before this cleanup path.
    }
    throw err;
  }
}

export type WorkflowUpdateChanges = Partial<Pick<Workflow,
  'name' | 'description' | 'visualProof' | 'planFile' | 'repoUrl' | 'intermediateRepoUrl' |
  'branch' | 'onFinish' | 'baseBranch' | 'featureBranch' | 'mergeMode' | 'reviewProvider' |
  'generation' | 'updatedAt'
>>;

export function buildWorkflowUpdate(changes: WorkflowUpdateChanges): SQLiteUpdateParts {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  const columnMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    planFile: 'plan_file',
    repoUrl: 'repo_url',
    intermediateRepoUrl: 'intermediate_repo_url',
    branch: 'branch',
    onFinish: 'on_finish',
    baseBranch: 'base_branch',
    featureBranch: 'feature_branch',
    mergeMode: 'merge_mode',
    reviewProvider: 'review_provider',
  };
  const changeRecord = changes as Record<string, unknown>;
  for (const [key, column] of Object.entries(columnMap)) {
    if (key in changes) {
      setClauses.push(`${column} = ?`);
      values.push(changeRecord[key] ?? null);
    }
  }
  if (changes.visualProof !== undefined) {
    setClauses.push('visual_proof = ?');
    values.push(changes.visualProof ? 1 : 0);
  }
  if (changes.baseBranch !== undefined) {
    // handled by columnMap; kept for backward-compatible patch shapes
  }
  if (changes.generation !== undefined) {
    setClauses.push('generation = ?');
    values.push(changes.generation);
  }
  if (changes.mergeMode !== undefined) {
    // handled by columnMap; kept for backward-compatible patch shapes
  }
  setClauses.push('updated_at = ?');
  values.push(changes.updatedAt ?? new Date().toISOString());
  return { setClauses, values };
}

export function buildTaskUpdate(changes: TaskStateChanges): SQLiteUpdateParts {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (changes.description !== undefined) {
    setClauses.push('description = ?');
    values.push(changes.description);
  }
  if (changes.status !== undefined) {
    setClauses.push('status = ?');
    values.push(changes.status);
  }
  if (changes.dependencies !== undefined) {
    setClauses.push('dependencies = ?');
    values.push(JSON.stringify(changes.dependencies));
  }

  if (changes.config) {
    const configMap: Record<string, string> = {
      workflowId: 'workflow_id',
      parentTask: 'parent_task',
      command: 'command',
      prompt: 'prompt',
      experimentPrompt: 'experiment_prompt',
      summary: 'summary',
      problem: 'problem',
      approach: 'approach',
      testPlan: 'test_plan',
      reproCommand: 'repro_command',
      featureBranch: 'feature_branch',
      runnerKind: 'runner_kind',
      poolId: 'pool_id',
      poolMemberId: 'pool_member_id',
      dockerImage: 'docker_image',
      executionAgent: 'execution_agent',
      fixPrompt: 'fix_prompt',
      fixContext: 'fix_context',
    };
    const configBoolMap: Record<string, string> = {
      pivot: 'pivot',
      isReconciliation: 'is_reconciliation',
      requiresManualApproval: 'requires_manual_approval',
      isMergeNode: 'is_merge_node',
    };
    const config = changes.config as Record<string, unknown>;

    for (const [key, col] of Object.entries(configMap)) {
      if (key in changes.config) {
        setClauses.push(`${col} = ?`);
        values.push(config[key] ?? null);
      }
    }
    for (const [key, col] of Object.entries(configBoolMap)) {
      if (key in changes.config) {
        setClauses.push(`${col} = ?`);
        values.push(config[key] ? 1 : 0);
      }
    }
    if ('experimentVariants' in changes.config) {
      setClauses.push('experiment_variants = ?');
      values.push(changes.config.experimentVariants ? JSON.stringify(changes.config.experimentVariants) : null);
    }
    if ('externalDependencies' in changes.config) {
      setClauses.push('external_dependencies = ?');
      values.push(changes.config.externalDependencies ? JSON.stringify(changes.config.externalDependencies) : null);
    }
  }

  if (changes.execution) {
    const execMap: Record<string, string> = {
      blockedBy: 'blocked_by',
      inputPrompt: 'input_prompt',
      exitCode: 'exit_code',
      error: 'error',
      protocolErrorCode: 'protocol_error_code',
      protocolErrorMessage: 'protocol_error_message',
      actionRequestId: 'action_request_id',
      branch: 'branch',
      commit: 'commit_hash',
      fixedIntegrationSha: 'fixed_integration_sha',
      fixedIntegrationSource: 'fixed_integration_source',
      agentSessionId: 'agent_session_id',
      lastAgentSessionId: 'last_agent_session_id',
      workspacePath: 'workspace_path',
      containerId: 'container_id',
      selectedExperiment: 'selected_experiment',
      pendingFixError: 'pending_fix_error',
      reviewUrl: 'review_url',
      reviewId: 'review_id',
      reviewStatus: 'review_status',
      reviewProviderId: 'review_provider_id',
      phase: 'launch_phase',
      generation: 'execution_generation',
      selectedAttemptId: 'selected_attempt_id',
      agentName: 'agent_name',
      lastAgentName: 'last_agent_name',
      autoFixAttempts: 'auto_fix_attempts',
    };
    const execDateMap: Record<string, string> = {
      startedAt: 'started_at',
      completedAt: 'completed_at',
      lastHeartbeatAt: 'last_heartbeat_at',
      launchStartedAt: 'launch_started_at',
      launchCompletedAt: 'launch_completed_at',
      fixedIntegrationRecordedAt: 'fixed_integration_recorded_at',
    };
    const execJsonFields: Record<string, string> = {
      experiments: 'experiments',
      selectedExperiments: 'selected_experiments',
      experimentResults: 'experiment_results',
    };
    const execution = changes.execution as Record<string, unknown>;

    for (const [key, col] of Object.entries(execMap)) {
      if (key in changes.execution) {
        setClauses.push(`${col} = ?`);
        values.push(execution[key] ?? null);
      }
    }
    for (const [key, col] of Object.entries(execDateMap)) {
      if (key in changes.execution) {
        setClauses.push(`${col} = ?`);
        values.push(toSqlDateValue(execution[key]));
      }
    }
    for (const [key, col] of Object.entries(execJsonFields)) {
      if (key in changes.execution) {
        setClauses.push(`${col} = ?`);
        const val = execution[key];
        values.push(val ? JSON.stringify(val) : null);
      }
    }
    const execBoolMap: Record<string, string> = {
      isFixingWithAI: 'is_fixing_with_ai',
    };
    for (const [key, col] of Object.entries(execBoolMap)) {
      if (key in changes.execution) {
        setClauses.push(`${col} = ?`);
        values.push(execution[key] ? 1 : 0);
      }
    }
  }

  if (setClauses.length === 0) return { setClauses, values };

  setClauses.push('task_state_version = task_state_version + 1');
  return { setClauses, values };
}

export function buildAttemptUpdate(
  changes: Partial<Pick<Attempt,
    'status' | 'claimedAt' | 'startedAt' | 'completedAt' | 'exitCode' | 'error' |
    'lastHeartbeatAt' | 'leaseExpiresAt' | 'branch' | 'commit' | 'summary' |
    'queuePriority' | 'workspacePath' | 'agentSessionId' | 'containerId' | 'mergeConflict'
  >>,
): SQLiteUpdateParts {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (changes.status !== undefined) { setClauses.push('status = ?'); values.push(changes.status); }
  if (changes.claimedAt !== undefined) { setClauses.push('claimed_at = ?'); values.push(toSqlDateValue(changes.claimedAt)); }
  if (changes.startedAt !== undefined) { setClauses.push('started_at = ?'); values.push(toSqlDateValue(changes.startedAt)); }
  if (changes.completedAt !== undefined) { setClauses.push('completed_at = ?'); values.push(toSqlDateValue(changes.completedAt)); }
  if (changes.exitCode !== undefined) { setClauses.push('exit_code = ?'); values.push(changes.exitCode); }
  if (changes.error !== undefined) { setClauses.push('error = ?'); values.push(changes.error); }
  if (changes.lastHeartbeatAt !== undefined) { setClauses.push('last_heartbeat_at = ?'); values.push(toSqlDateValue(changes.lastHeartbeatAt)); }
  if (changes.leaseExpiresAt !== undefined) { setClauses.push('lease_expires_at = ?'); values.push(toSqlDateValue(changes.leaseExpiresAt)); }
  if (changes.branch !== undefined) { setClauses.push('branch = ?'); values.push(changes.branch); }
  if (changes.commit !== undefined) { setClauses.push('commit_hash = ?'); values.push(changes.commit); }
  if (changes.summary !== undefined) { setClauses.push('summary = ?'); values.push(changes.summary); }
  if (changes.queuePriority !== undefined) { setClauses.push('queue_priority = ?'); values.push(changes.queuePriority); }
  if (changes.workspacePath !== undefined) { setClauses.push('workspace_path = ?'); values.push(changes.workspacePath); }
  if (changes.agentSessionId !== undefined) { setClauses.push('agent_session_id = ?'); values.push(changes.agentSessionId); }
  if (changes.containerId !== undefined) { setClauses.push('container_id = ?'); values.push(changes.containerId); }
  if (changes.mergeConflict !== undefined) { setClauses.push('merge_conflict = ?'); values.push(changes.mergeConflict ? JSON.stringify(changes.mergeConflict) : null); }

  return { setClauses, values };
}

function toSqlDateValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value ?? null;
}
