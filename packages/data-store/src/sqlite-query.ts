import type {
  Attempt,
  TaskState,
  TaskStatus,
  WorkflowRollup,
  WorkflowRollupTaskSummary,
} from '@invoker/workflow-core';
import {
  computeWorkflowRollupFromSummaries,
  isDiscardedAttempt,
  normalizeRunnerKind,
} from '@invoker/workflow-core';
import type { Workflow } from './adapter.js';
import type {
  TaskLaunchDispatch,
  TaskLaunchDispatchPriority,
  TaskLaunchDispatchState,
  WorkflowMutationIntent,
  WorkflowMutationIntentStatus,
  WorkflowMutationLease,
} from './sqlite-adapter.js';
import type { NativeDatabaseCompat } from './sqlite-native.js';
import { paramsToArgs } from './sqlite-native.js';

export function querySQLiteOne(
  db: NativeDatabaseCompat,
  sql: string,
  params: unknown[] = [],
): Record<string, unknown> | undefined {
  const stmt = db.prepare(sql);
  try {
    return stmt.get(...(paramsToArgs(params) as any[])) as Record<string, unknown> | undefined;
  } finally {
    stmt.free();
  }
}

export function querySQLiteAll(
  db: NativeDatabaseCompat,
  sql: string,
  params: unknown[] = [],
): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  try {
    return stmt.all(...(paramsToArgs(params) as any[])) as Record<string, unknown>[];
  } finally {
    stmt.free();
  }
}

export function computeSQLiteWorkflowRollupsFromRows(
  workflowIds: string[],
  taskRows: Record<string, unknown>[],
): Map<string, WorkflowRollup> {
  const rollups = new Map<string, WorkflowRollup>();
  const tasksByWorkflow = new Map<string, WorkflowRollupTaskSummary[]>();
  for (const row of taskRows as any[]) {
    const workflowId = String(row.workflow_id);
    const tasks = tasksByWorkflow.get(workflowId) ?? [];
    tasks.push({
      id: String(row.id),
      description: String(row.description),
      status: row.status as TaskStatus,
      dependencies: JSON.parse(row.dependencies || '[]'),
      execution: {
        error: row.error ?? undefined,
        protocolErrorCode: row.protocol_error_code ?? undefined,
        protocolErrorMessage: row.protocol_error_message ?? undefined,
        pendingFixError: row.pending_fix_error ?? undefined,
        exitCode: row.exit_code ?? undefined,
        completedAt: row.completed_at ?? undefined,
        agentSessionId: row.agent_session_id ?? undefined,
        agentName: row.agent_name ?? undefined,
        reviewUrl: row.review_url ?? undefined,
        inputPrompt: row.input_prompt ?? undefined,
        isFixingWithAI: row.is_fixing_with_ai === 1,
      },
    });
    tasksByWorkflow.set(workflowId, tasks);
  }

  for (const workflowId of workflowIds) {
    const tasks = tasksByWorkflow.get(workflowId) ?? [];
    rollups.set(workflowId, computeWorkflowRollupFromSummaries(tasks));
  }

  return rollups;
}

export function rowToSQLiteWorkflow(row: any, rollup?: WorkflowRollup): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    visualProof: row.visual_proof === 1,
    status: rollup?.status ?? 'pending',
    rollup,
    planFile: row.plan_file ?? undefined,
    repoUrl: row.repo_url ?? undefined,
    intermediateRepoUrl: row.intermediate_repo_url ?? undefined,
    branch: row.branch ?? undefined,
    onFinish: row.on_finish ?? undefined,
    baseBranch: row.base_branch ?? undefined,
    featureBranch: row.feature_branch ?? undefined,
    mergeMode: row.merge_mode ?? undefined,
    reviewProvider: row.review_provider ?? undefined,
    generation: row.generation ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToSQLiteTask(row: any): TaskState {
  const normalizedStatus = row.status as TaskStatus;
  return {
    id: row.id,
    description: row.description,
    status: normalizedStatus,
    dependencies: JSON.parse(row.dependencies || '[]'),
    createdAt: new Date(row.created_at),
    config: {
      workflowId: row.workflow_id ?? undefined,
      parentTask: row.parent_task ?? undefined,
      command: row.command ?? undefined,
      prompt: row.prompt ?? undefined,
      externalDependencies: row.external_dependencies ? JSON.parse(row.external_dependencies) : undefined,
      experimentPrompt: row.experiment_prompt ?? undefined,
      pivot: row.pivot === 1 ? true : undefined,
      experimentVariants: row.experiment_variants ? JSON.parse(row.experiment_variants) : undefined,
      isReconciliation: row.is_reconciliation === 1 ? true : undefined,
      requiresManualApproval: row.requires_manual_approval === 1 ? true : undefined,
      featureBranch: row.feature_branch ?? undefined,
      poolId: row.pool_id ?? undefined,
      runnerKind: normalizeRunnerKind(row.runner_kind ?? undefined),
      ...((row.pool_member_id ?? undefined) ? { poolMemberId: row.pool_member_id } : {}),
      dockerImage: row.docker_image ?? undefined,
      isMergeNode: row.is_merge_node === 1 ? true : undefined,
      summary: row.summary ?? undefined,
      problem: row.problem ?? undefined,
      approach: row.approach ?? undefined,
      testPlan: row.test_plan ?? undefined,
      reproCommand: row.repro_command ?? undefined,
      fixPrompt: row.fix_prompt ?? undefined,
      fixContext: row.fix_context ?? undefined,
      executionAgent: row.execution_agent ?? undefined,
    },
    execution: {
      blockedBy: row.blocked_by ?? undefined,
      inputPrompt: row.input_prompt ?? undefined,
      exitCode: row.exit_code ?? undefined,
      error: row.error ?? undefined,
      protocolErrorCode: row.protocol_error_code ?? undefined,
      protocolErrorMessage: row.protocol_error_message ?? undefined,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at) : undefined,
      actionRequestId: row.action_request_id ?? undefined,
      branch: row.branch ?? undefined,
      commit: row.commit_hash ?? undefined,
      fixedIntegrationSha: row.fixed_integration_sha ?? undefined,
      fixedIntegrationRecordedAt: row.fixed_integration_recorded_at ? new Date(row.fixed_integration_recorded_at) : undefined,
      fixedIntegrationSource: row.fixed_integration_source ?? undefined,
      agentSessionId: row.agent_session_id || undefined,
      lastAgentSessionId: row.last_agent_session_id || undefined,
      agentName: row.agent_name ?? undefined,
      lastAgentName: row.last_agent_name ?? undefined,
      workspacePath: row.workspace_path ?? undefined,
      containerId: row.container_id ?? undefined,
      experiments: row.experiments ? JSON.parse(row.experiments) : undefined,
      selectedExperiment: row.selected_experiment ?? undefined,
      selectedExperiments: row.selected_experiments ? JSON.parse(row.selected_experiments) : undefined,
      experimentResults: row.experiment_results ? JSON.parse(row.experiment_results) : undefined,
      pendingFixError: row.pending_fix_error ?? undefined,
      reviewUrl: row.review_url ?? undefined,
      reviewId: row.review_id ?? undefined,
      reviewStatus: row.review_status ?? undefined,
      reviewProviderId: row.review_provider_id ?? undefined,
      phase: row.launch_phase ?? undefined,
      launchStartedAt: row.launch_started_at ? new Date(row.launch_started_at) : undefined,
      launchCompletedAt: row.launch_completed_at ? new Date(row.launch_completed_at) : undefined,
      generation: row.execution_generation ?? 0,
      selectedAttemptId: row.selected_attempt_id ?? undefined,
      autoFixAttempts: row.auto_fix_attempts ?? undefined,
    },
    taskStateVersion: row.task_state_version ?? 1,
  };
}

export function reconcileSQLiteTaskFromSelectedAttempt(
  task: TaskState,
  loadAttempt: (attemptId: string) => Attempt | undefined,
): TaskState {
  const attemptId = task.execution.selectedAttemptId;
  if (!attemptId) return task;

  const taskIsTerminal =
    task.status === 'completed' ||
    task.status === 'failed' ||
    task.status === 'fixing_with_ai' ||
    task.status === 'needs_input' ||
    task.status === 'awaiting_approval' ||
    task.status === 'review_ready' ||
    task.status === 'stale';
  if (taskIsTerminal) return task;

  const attempt = loadAttempt(attemptId);
  if (!attempt) return task;

  if (isDiscardedAttempt(attempt)) {
    return {
      ...task,
      status: 'stale',
    };
  }

  if (attempt.status === 'failed') {
    return {
      ...task,
      status: 'failed',
      execution: {
        ...task.execution,
        exitCode: attempt.exitCode ?? task.execution.exitCode,
        error: attempt.error ?? task.execution.error,
        completedAt: attempt.completedAt ?? task.execution.completedAt,
        lastHeartbeatAt: attempt.lastHeartbeatAt ?? task.execution.lastHeartbeatAt,
        branch: attempt.branch ?? task.execution.branch,
        commit: attempt.commit ?? task.execution.commit,
        workspacePath: attempt.workspacePath ?? task.execution.workspacePath,
        agentSessionId: attempt.agentSessionId ?? task.execution.agentSessionId,
        containerId: attempt.containerId ?? task.execution.containerId,
      },
    };
  }

  if (attempt.status === 'completed') {
    return {
      ...task,
      status: 'completed',
      config: {
        ...task.config,
        summary: attempt.summary ?? task.config.summary,
      },
      execution: {
        ...task.execution,
        exitCode: attempt.exitCode ?? task.execution.exitCode,
        completedAt: attempt.completedAt ?? task.execution.completedAt,
        lastHeartbeatAt: attempt.lastHeartbeatAt ?? task.execution.lastHeartbeatAt,
        branch: attempt.branch ?? task.execution.branch,
        commit: attempt.commit ?? task.execution.commit,
        workspacePath: attempt.workspacePath ?? task.execution.workspacePath,
        agentSessionId: attempt.agentSessionId ?? task.execution.agentSessionId,
        containerId: attempt.containerId ?? task.execution.containerId,
      },
    };
  }

  if (attempt.status === 'needs_input') {
    return {
      ...task,
      status: 'needs_input',
    };
  }

  return task;
}

export function rowToSQLiteAttempt(row: any): Attempt {
  return {
    id: row.id,
    nodeId: row.node_id,
    queuePriority: Number(row.queue_priority ?? 0),
    status: row.status,
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : undefined,
    snapshotCommit: row.snapshot_commit ?? undefined,
    baseBranch: row.base_branch ?? undefined,
    upstreamAttemptIds: JSON.parse(row.upstream_attempt_ids || '[]'),
    commandOverride: row.command_override ?? undefined,
    promptOverride: row.prompt_override ?? undefined,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    exitCode: row.exit_code ?? undefined,
    error: row.error ?? undefined,
    lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at) : undefined,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : undefined,
    branch: row.branch ?? undefined,
    commit: row.commit_hash ?? undefined,
    summary: row.summary ?? undefined,
    workspacePath: row.workspace_path ?? undefined,
    agentSessionId: row.agent_session_id || undefined,
    containerId: row.container_id ?? undefined,
    supersedesAttemptId: row.supersedes_attempt_id ?? undefined,
    createdAt: new Date(row.created_at),
    mergeConflict: row.merge_conflict ? JSON.parse(row.merge_conflict) : undefined,
  };
}

export function rowToSQLiteTaskLaunchDispatch(row: Record<string, unknown>): TaskLaunchDispatch {
  const priorityRaw = String(row.priority ?? 'normal');
  const priority: TaskLaunchDispatchPriority =
    priorityRaw === 'high' || priorityRaw === 'low' ? priorityRaw : 'normal';
  return {
    id: Number(row.id),
    taskId: String(row.task_id),
    attemptId: String(row.attempt_id),
    workflowId: String(row.workflow_id),
    state: String(row.state ?? 'enqueued') as TaskLaunchDispatchState,
    priority,
    dispatchOwner: row.dispatch_owner ? String(row.dispatch_owner) : undefined,
    enqueuedAt: String(row.enqueued_at),
    leasedAt: row.leased_at ? String(row.leased_at) : undefined,
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    fencedUntil: row.fenced_until ? String(row.fenced_until) : undefined,
    attemptsCount: Number(row.attempts_count ?? 0),
    lastError: row.last_error ? String(row.last_error) : undefined,
    generation: Number(row.generation ?? 0),
  };
}

export function rowToSQLiteWorkflowMutationIntent(row: Record<string, unknown>): WorkflowMutationIntent {
  return {
    id: Number(row.id),
    workflowId: String(row.workflow_id),
    channel: String(row.channel),
    args: JSON.parse(String(row.args_json ?? '[]')),
    priority: row.priority === 'high' ? 'high' : 'normal',
    status: (row.status as WorkflowMutationIntentStatus) ?? 'queued',
    ownerId: (row.owner_id as string) ?? undefined,
    error: (row.error as string) ?? undefined,
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string) ?? undefined,
    completedAt: (row.completed_at as string) ?? undefined,
  };
}

export function rowToSQLiteWorkflowMutationLease(row: Record<string, unknown>): WorkflowMutationLease {
  return {
    workflowId: String(row.workflow_id),
    ownerId: String(row.owner_id),
    activeIntentId: row.active_intent_id === null || row.active_intent_id === undefined
      ? undefined
      : Number(row.active_intent_id),
    activeMutationKind: row.active_mutation_kind ? String(row.active_mutation_kind) : undefined,
    leasedAt: String(row.leased_at),
    lastHeartbeatAt: String(row.last_heartbeat_at),
    leaseExpiresAt: String(row.lease_expires_at),
  };
}
