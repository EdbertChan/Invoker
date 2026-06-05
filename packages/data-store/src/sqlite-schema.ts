import type { ExternalDependency } from '@invoker/workflow-core';

export interface SQLiteSchemaDatabase {
  run(sql: string, params?: unknown[]): void;
}

export const SQLITE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    visual_proof INTEGER,
    plan_file TEXT,
    repo_url TEXT,
    intermediate_repo_url TEXT,
    branch TEXT,
    on_finish TEXT,
    base_branch TEXT,
    parent_remote TEXT,
    feature_branch TEXT,
    merge_mode TEXT,
    review_provider TEXT,
    external_dependencies TEXT,
    external_dependency_changes TEXT,
    generation INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    blocked_by TEXT,
    dependencies TEXT DEFAULT '[]',
    command TEXT,
    prompt TEXT,
    exit_code INTEGER,
    error TEXT,
    protocol_error_code TEXT,
    protocol_error_message TEXT,
    input_prompt TEXT,
    external_dependencies TEXT,

    -- Context
    summary TEXT,
    problem TEXT,
    approach TEXT,
    test_plan TEXT,
    repro_command TEXT,
    fix_prompt TEXT,
    fix_context TEXT,

    -- Git
    branch TEXT,
    commit_hash TEXT,
    fixed_integration_sha TEXT,
    fixed_integration_recorded_at TEXT,
    fixed_integration_source TEXT,
    parent_task TEXT,

    -- Experiments
    pivot INTEGER DEFAULT 0,
    experiment_variants TEXT,
    is_reconciliation INTEGER DEFAULT 0,
    selected_experiment TEXT,
    experiment_results TEXT,
    requires_manual_approval INTEGER DEFAULT 0,

    -- Repository
    repo_url TEXT,
    feature_branch TEXT,

    -- Merge node
    is_merge_node INTEGER DEFAULT 0,

    -- Claude session
    claude_session_id TEXT,
    workspace_path TEXT,

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),
    launch_phase TEXT,
    launch_started_at TEXT,
    launch_completed_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    execution_generation INTEGER DEFAULT 0,
    docker_image TEXT,

    FOREIGN KEY (workflow_id) REFERENCES workflows(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    thread_ts TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    extracted_plan TEXT,
    plan_submitted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_ts TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (thread_ts) REFERENCES conversations(thread_ts)
  );

  CREATE INDEX IF NOT EXISTS idx_conv_messages_thread
    ON conversation_messages(thread_ts, seq);

  CREATE TABLE IF NOT EXISTS task_output (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_task_output_task
    ON task_output(task_id);

  CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id
    ON tasks(workflow_id);

  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    queue_priority INTEGER NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'pending',

    -- Input snapshot
    snapshot_commit TEXT,
    base_branch TEXT,
    upstream_attempt_ids TEXT DEFAULT '[]',

    -- Overrides
    command_override TEXT,
    prompt_override TEXT,

    -- Execution state
    claimed_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    exit_code INTEGER,
    error TEXT,
    last_heartbeat_at TEXT,
    lease_expires_at TEXT,

    -- Output
    branch TEXT,
    commit_hash TEXT,
    summary TEXT,
    workspace_path TEXT,
    claude_session_id TEXT,
    container_id TEXT,

    -- Lineage
    supersedes_attempt_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),

    -- Merge conflict
    merge_conflict TEXT,

    FOREIGN KEY (node_id) REFERENCES tasks(id)
  );

  CREATE INDEX IF NOT EXISTS idx_attempts_node_created
    ON attempts(node_id, created_at);

  CREATE TABLE IF NOT EXISTS workflow_mutation_intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    args_json TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'queued',
    owner_id TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id)
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_mutation_intents_workflow_status
    ON workflow_mutation_intents(workflow_id, status, priority, id);

  CREATE TABLE IF NOT EXISTS workflow_mutation_leases (
    workflow_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    active_intent_id INTEGER,
    active_mutation_kind TEXT,
    leased_at TEXT NOT NULL,
    last_heartbeat_at TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id),
    FOREIGN KEY (active_intent_id) REFERENCES workflow_mutation_intents(id)
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_mutation_leases_expiry
    ON workflow_mutation_leases(lease_expires_at);

  CREATE TABLE IF NOT EXISTS task_launch_dispatch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'enqueued',
    priority TEXT NOT NULL DEFAULT 'normal',
    dispatch_owner TEXT,
    enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
    leased_at TEXT,
    acknowledged_at TEXT,
    completed_at TEXT,
    fenced_until TEXT,
    attempts_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    generation INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (workflow_id) REFERENCES workflows(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_launch_dispatch_active_attempt
    ON task_launch_dispatch(attempt_id)
    WHERE state IN ('enqueued', 'leased', 'acknowledged');

  CREATE INDEX IF NOT EXISTS idx_task_launch_dispatch_ready
    ON task_launch_dispatch(state, priority, id)
    WHERE state IN ('enqueued', 'leased');

  CREATE INDEX IF NOT EXISTS idx_task_launch_dispatch_workflow_state
    ON task_launch_dispatch(workflow_id, state);

  CREATE INDEX IF NOT EXISTS idx_task_launch_dispatch_task_state
    ON task_launch_dispatch(task_id, state);

  CREATE TABLE IF NOT EXISTS execution_resource_leases (
    resource_key TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    holder_id TEXT NOT NULL,
    task_id TEXT,
    pool_id TEXT,
    pool_member_id TEXT,
    acquired_at TEXT NOT NULL,
    last_heartbeat_at TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    metadata_json TEXT,
    PRIMARY KEY(resource_key, holder_id)
  );

  CREATE INDEX IF NOT EXISTS idx_execution_resource_leases_resource
    ON execution_resource_leases(resource_key, lease_expires_at);

  CREATE INDEX IF NOT EXISTS idx_execution_resource_leases_expiry
    ON execution_resource_leases(lease_expires_at);

  CREATE TABLE IF NOT EXISTS output_spool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    offset INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE INDEX IF NOT EXISTS idx_output_spool_task_offset
    ON output_spool(task_id, offset);
`;

export const SQLITE_MIGRATION_STATEMENTS = [
  'ALTER TABLE tasks ADD COLUMN claude_session_id TEXT',
  'ALTER TABLE tasks ADD COLUMN workspace_path TEXT',
  'ALTER TABLE tasks ADD COLUMN container_id TEXT',
  'ALTER TABLE tasks ADD COLUMN is_merge_node INTEGER DEFAULT 0',
  'ALTER TABLE workflows ADD COLUMN on_finish TEXT',
  'ALTER TABLE workflows ADD COLUMN base_branch TEXT',
  'ALTER TABLE workflows ADD COLUMN parent_remote TEXT',
  'ALTER TABLE workflows ADD COLUMN feature_branch TEXT',
  'ALTER TABLE workflows ADD COLUMN generation INTEGER DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN last_heartbeat_at TEXT',
  'ALTER TABLE tasks ADD COLUMN experiment_prompt TEXT',
  'ALTER TABLE tasks ADD COLUMN auto_fix INTEGER DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN max_fix_attempts INTEGER',
  'ALTER TABLE tasks ADD COLUMN action_request_id TEXT',
  'ALTER TABLE tasks ADD COLUMN experiments TEXT',
  'ALTER TABLE tasks ADD COLUMN selected_experiments TEXT',
  'ALTER TABLE tasks ADD COLUMN utilization INTEGER',
  'ALTER TABLE tasks ADD COLUMN pending_fix_error TEXT',
  'ALTER TABLE workflows ADD COLUMN merge_mode TEXT',
  'ALTER TABLE tasks ADD COLUMN review_url TEXT',
  'ALTER TABLE tasks ADD COLUMN review_id TEXT',
  'ALTER TABLE tasks ADD COLUMN review_status TEXT',
  'ALTER TABLE tasks ADD COLUMN review_provider_id TEXT',
  'ALTER TABLE tasks ADD COLUMN is_fixing_with_ai INTEGER DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN execution_generation INTEGER DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN docker_image TEXT',
  'ALTER TABLE tasks ADD COLUMN selected_attempt_id TEXT',
  'ALTER TABLE tasks ADD COLUMN pool_member_id TEXT',
  'ALTER TABLE workflows ADD COLUMN description TEXT',
  'ALTER TABLE workflows ADD COLUMN visual_proof INTEGER',
  'ALTER TABLE workflows ADD COLUMN intermediate_repo_url TEXT',
  'ALTER TABLE tasks ADD COLUMN agent_session_id TEXT',
  'ALTER TABLE attempts ADD COLUMN agent_session_id TEXT',
  'ALTER TABLE workflows ADD COLUMN review_provider TEXT',
  'ALTER TABLE workflows ADD COLUMN external_dependencies TEXT',
  'ALTER TABLE workflows ADD COLUMN external_dependency_changes TEXT',
  'ALTER TABLE tasks ADD COLUMN execution_agent TEXT',
  'ALTER TABLE tasks ADD COLUMN agent_name TEXT',
  'ALTER TABLE tasks ADD COLUMN last_agent_session_id TEXT',
  'ALTER TABLE tasks ADD COLUMN last_agent_name TEXT',
  'ALTER TABLE tasks ADD COLUMN external_dependencies TEXT',
  'ALTER TABLE tasks ADD COLUMN runner_kind TEXT',
  'ALTER TABLE tasks ADD COLUMN pool_id TEXT',
  'ALTER TABLE tasks ADD COLUMN auto_fix_attempts INTEGER DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN launch_phase TEXT',
  'ALTER TABLE tasks ADD COLUMN launch_started_at TEXT',
  'ALTER TABLE tasks ADD COLUMN launch_completed_at TEXT',
  'ALTER TABLE tasks ADD COLUMN fixed_integration_sha TEXT',
  'ALTER TABLE tasks ADD COLUMN fixed_integration_recorded_at TEXT',
  'ALTER TABLE tasks ADD COLUMN fixed_integration_source TEXT',
  'ALTER TABLE tasks ADD COLUMN fix_prompt TEXT',
  'ALTER TABLE tasks ADD COLUMN fix_context TEXT',
  'ALTER TABLE attempts ADD COLUMN queue_priority INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE attempts ADD COLUMN claimed_at TEXT',
  'ALTER TABLE attempts ADD COLUMN lease_expires_at TEXT',
  'ALTER TABLE tasks ADD COLUMN task_state_version INTEGER NOT NULL DEFAULT 1',
];

export function initSQLiteSchema(db: SQLiteSchemaDatabase): void {
  db.run(SQLITE_SCHEMA_SQL);
}

/**
 * Rewrite `pnpm test packages/<pkg>/...` (incorrect root-level invocation)
 * to `cd packages/<pkg> && pnpm test -- <relative-path>`.
 */
export function rewritePnpmTestCommand(cmd: string): string {
  const withFile = cmd.match(/^(pnpm test)\s+(?:--\s+)?packages\/([^/\s]+)\/(\S+)(.*)/);
  if (withFile) {
    const [, , pkg, rest, suffix] = withFile;
    return `cd packages/${pkg} && pnpm test -- ${rest}${suffix}`;
  }
  const pkgOnly = cmd.match(/^(pnpm test)\s+(?:--\s+)?packages\/([^/\s]+)(.*)/);
  if (pkgOnly) {
    const [, , pkg, suffix] = pkgOnly;
    return `cd packages/${pkg} && pnpm test${suffix}`;
  }
  return cmd;
}

export function parseExecutorSelectedPoolMemberId(payload: string | null | undefined): string | undefined {
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(payload) as { poolMemberId?: unknown };
    return typeof parsed.poolMemberId === 'string' && parsed.poolMemberId.trim()
      ? parsed.poolMemberId.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeExternalDependencies(raw: unknown): ExternalDependency[] {
  if (!Array.isArray(raw)) return [];
  const normalized: ExternalDependency[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const dep = item as Record<string, unknown>;
    if (typeof dep.workflowId !== 'string' || dep.workflowId.trim() === '') continue;
    const taskId = typeof dep.taskId === 'string' && dep.taskId.trim() !== '' ? dep.taskId.trim() : '__merge__';
    const gatePolicy = dep.gatePolicy === 'review_ready' ? 'review_ready' : 'completed';
    normalized.push({
      workflowId: dep.workflowId.trim(),
      taskId,
      requiredStatus: 'completed',
      gatePolicy,
    });
  }
  return normalized;
}

export function mergeExternalDependencySets(
  existing: ExternalDependency[],
  incoming: ExternalDependency[],
): ExternalDependency[] {
  const byKey = new Map<string, ExternalDependency>();
  for (const dep of [...existing, ...incoming]) {
    const taskId = dep.taskId?.trim() || '__merge__';
    const key = `${dep.workflowId}::${taskId}`;
    const previous = byKey.get(key);
    const gatePolicy =
      previous?.gatePolicy === 'completed' || dep.gatePolicy === 'completed'
        ? 'completed'
        : 'review_ready';
    byKey.set(key, {
      workflowId: dep.workflowId,
      taskId,
      requiredStatus: 'completed',
      gatePolicy,
    });
  }
  return Array.from(byKey.values());
}
