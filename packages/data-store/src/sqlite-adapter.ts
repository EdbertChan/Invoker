/**
 * SQLiteAdapter — PersistenceAdapter backed by native SQLite.
 *
 * Uses `:memory:` for testing, file path for production.
 * Construction remains async for API compatibility, all operations after init are synchronous.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  TaskState,
  TaskStateChanges,
  Attempt,
  WorkflowRollup,
} from '@invoker/workflow-core';
import { DISPATCH_LEASE_MS } from '@invoker/contracts';
import type { SearchResultItem, SearchOptions } from '@invoker/contracts';
import { normalizeRunnerKind } from '@invoker/workflow-core';
import type {
  PersistenceAdapter,
  Workflow,
  WorkflowTaskSnapshot,
  TaskEvent,
  ActivityLogEntry,
  Conversation,
  ConversationMessage,
} from './adapter.js';
import {
  configureSQLiteConnection,
  initSQLiteSchema,
  migrateSQLiteSchema,
  runSQLiteCompatibilityMigration,
  type SQLiteSchemaContext,
} from './sqlite-schema.js';
import {
  computeSQLiteWorkflowRollupsFromRows,
  querySQLiteAll,
  querySQLiteOne,
  reconcileSQLiteTaskFromSelectedAttempt,
  rowToSQLiteAttempt,
  rowToSQLiteTask,
  rowToSQLiteTaskLaunchDispatch,
  rowToSQLiteWorkflow,
  rowToSQLiteWorkflowMutationIntent,
  rowToSQLiteWorkflowMutationLease,
} from './sqlite-query.js';
import { loadNativeSqlite, NativeDatabaseCompat, sqlStringLiteral } from './sqlite-native.js';
import {
  buildAttemptUpdate,
  buildTaskUpdate,
  buildWorkflowUpdate,
  ensureSQLiteWritable,
  execSQLiteRun,
  runSQLiteTransaction,
  type SQLiteWriteContext,
} from './sqlite-write.js';

export interface OutputChunk {
  offset: number;
  data: string;
}

interface SQLiteAdapterOptions {
  readOnly?: boolean;
  ownerCapability?: boolean;
  outputTailLimit?: number;
  outputDir?: string;
}

export type WorkflowMutationPriority = 'high' | 'normal';
export type WorkflowMutationIntentStatus = 'queued' | 'running' | 'completed' | 'failed';
export const WORKFLOW_MUTATION_LEASE_MS = 30_000;
export const EXECUTION_RESOURCE_LEASE_MS = 20 * 60 * 1000;

export interface ExecutionResourceLease {
  resourceKey: string;
  resourceType: string;
  holderId: string;
  taskId?: string;
  poolId?: string;
  poolMemberId?: string;
  acquiredAt: string;
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
  metadata?: unknown;
}

export interface WorkflowMutationIntent {
  id: number;
  workflowId: string;
  channel: string;
  args: unknown[];
  priority: WorkflowMutationPriority;
  status: WorkflowMutationIntentStatus;
  ownerId?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowMutationLease {
  workflowId: string;
  ownerId: string;
  activeIntentId?: number;
  activeMutationKind?: string;
  leasedAt: string;
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
}

export type TaskLaunchDispatchState =
  | 'enqueued'
  | 'leased'
  | 'acknowledged'
  | 'completed'
  | 'abandoned';

export type TaskLaunchDispatchPriority = 'high' | 'normal' | 'low';

export interface TaskLaunchDispatch {
  id: number;
  taskId: string;
  attemptId: string;
  workflowId: string;
  state: TaskLaunchDispatchState;
  priority: TaskLaunchDispatchPriority;
  dispatchOwner?: string;
  enqueuedAt: string;
  leasedAt?: string;
  acknowledgedAt?: string;
  completedAt?: string;
  fencedUntil?: string;
  attemptsCount: number;
  lastError?: string;
  generation: number;
}

export class SQLiteAdapter implements PersistenceAdapter {
  private db: NativeDatabaseCompat;
  private nativeDb: DatabaseSync;
  private dbPath: string | null;
  private readOnly: boolean;
  private dirty = false;
  private outputTailLimit: number;
  private outputTailCache = new Map<string, OutputChunk[]>();
  private outputDir: string;
  private spoolNextOffsetCache = new Map<string, number>();
  private writeTransactionDepth = 0;
  private lastWorkflowTaskSnapshotStats: Record<string, unknown> | null = null;
  private writeContext: SQLiteWriteContext;
  private schemaContext: SQLiteSchemaContext;

  /** Use SQLiteAdapter.create() instead. */
  private constructor(db: DatabaseSync, dbPath: string | null, options?: SQLiteAdapterOptions) {
    this.nativeDb = db;
    this.db = new NativeDatabaseCompat(db);
    this.dbPath = dbPath;
    this.readOnly = options?.readOnly === true;
    this.outputTailLimit = options?.outputTailLimit ?? 100;
    this.outputDir = options?.outputDir ?? this.resolveOutputDir(dbPath);
    this.writeContext = {
      db: this.db,
      isReadOnly: () => this.readOnly,
      getTransactionDepth: () => this.writeTransactionDepth,
      setTransactionDepth: (depth) => {
        this.writeTransactionDepth = depth;
      },
      markDirty: () => {
        this.dirty = true;
      },
    };
    this.schemaContext = {
      db: this.db,
      isReadOnly: () => this.readOnly,
      queryOne: (sql, params) => this.queryOne(sql, params),
      queryAll: (sql, params) => this.queryAll(sql, params),
      execRun: (sql, params) => this.execRun(sql, params),
      runTransaction: (work) => this.runTransaction(work),
      markDirty: () => {
        this.dirty = true;
      },
    };
    this.configureConnection(dbPath !== null);
    if (!this.readOnly) {
      this.initSchema();
      this.migrate();
    }
  }

  /**
   * Async factory — opens or creates the database.
   * If the on-disk file is corrupted, backs it up and starts fresh.
   * @param dbPath File path or ':memory:' (default).
   * @param options readOnly=true opens DB for read operations without schema mutation.
   *                ownerCapability=true is required to open DB in writable mode for file-backed databases.
   */
  static async create(dbPath: string = ':memory:', options?: SQLiteAdapterOptions): Promise<SQLiteAdapter> {
    const isFile = dbPath !== ':memory:';
    const requestWritable = options?.readOnly !== true;

    // Enforce owner-only writable initialization for file-backed databases
    if (isFile && requestWritable && !options?.ownerCapability) {
      throw new Error(
        'Writable persistence initialization requires owner capability. ' +
        'Non-owner processes must delegate mutations via IPC (headless.run, headless.resume, headless.exec) ' +
        'or open the database in read-only mode.',
      );
    }

    if (isFile) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    try {
      const { DatabaseSync } = await loadNativeSqlite();
      const db = new DatabaseSync(dbPath, { readOnly: options?.readOnly === true });
      return new SQLiteAdapter(db, isFile ? dbPath : null, options);
    } catch (err) {
      if (!isFile || options?.readOnly === true || !existsSync(dbPath)) {
        throw err;
      }
      const backupPath = `${dbPath}.corrupt-${Date.now()}`;
      console.error(
        `[SQLiteAdapter] Database corrupted (${err instanceof Error ? err.message : String(err)}). ` +
        `Backing up to ${backupPath} and starting fresh.`,
      );
      renameSync(dbPath, backupPath);
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${dbPath}${suffix}`;
        if (existsSync(sidecar)) renameSync(sidecar, `${backupPath}${suffix}`);
      }
      const { DatabaseSync } = await loadNativeSqlite();
      const db = new DatabaseSync(dbPath);
      return new SQLiteAdapter(db, dbPath, options);
    }
  }

  private resolveOutputDir(dbPath: string | null): string {
    const invokerHome = process.env.INVOKER_DB_DIR ?? (dbPath ? dirname(dbPath) : join(homedir(), '.invoker'));
    if (!dbPath && !process.env.INVOKER_DB_DIR) {
      return join(tmpdir(), `invoker-output-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    }
    return join(invokerHome, 'task-output');
  }

  private configureConnection(fileBacked: boolean): void {
    configureSQLiteConnection(this.nativeDb, fileBacked);
  }

  // ── SQLite Helpers ───────────────────────────────────────

  /** Run a single-row SELECT, returning the row as an object or undefined. */
  private queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
    return querySQLiteOne(this.db, sql, params);
  }

  /** Run a multi-row SELECT, returning an array of row objects. */
  private queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
    return querySQLiteAll(this.db, sql, params);
  }

  private ensureWritable(): void {
    ensureSQLiteWritable(this.writeContext);
  }

  /** Run an INSERT/UPDATE/DELETE. File-backed durability is handled by SQLite/WAL. */
  private execRun(sql: string, params: unknown[] = []): void {
    execSQLiteRun(this.writeContext, sql, params);
  }

  private runTransaction<T>(work: () => T): T {
    return runSQLiteTransaction(this.writeContext, work);
  }

  /** Public transactional wrapper for higher-level batched write paths. */
  runInTransaction<T>(work: () => T): T {
    return this.runTransaction(work);
  }

  runCompatibilityMigration(): {
    migratedFixingWithAiStatuses: number;
    normalizedMergeModes: number;
    staleAutoFixExperimentTasks: number;
    normalizedStaleLaunchMetadata: number;
    backfilledMissingSshPoolMemberIds: number;
  } {
    return runSQLiteCompatibilityMigration(this.schemaContext);
  }

  checkpointWal(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE'): void {
    if (!this.dbPath) return;
    try {
      this.nativeDb.exec(`PRAGMA wal_checkpoint(${mode})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/locked|busy/i.test(message)) {
        throw err;
      }
    }
  }

  async backupTo(destinationPath: string): Promise<void> {
    if (!this.dbPath) {
      throw new Error('SQLiteAdapter.backupTo requires a file-backed database');
    }
    mkdirSync(dirname(destinationPath), { recursive: true });
    const { backup } = await loadNativeSqlite();
    await backup(this.nativeDb, destinationPath);
    this.checkpointWal('PASSIVE');
  }

  private initSchema(): void {
    initSQLiteSchema(this.db);
  }

  /** Add columns that may not exist in older databases. */
  private migrate(): void {
    migrateSQLiteSchema(this.schemaContext);
  }

  // -- Workflows ---------------------------------------------------------

  saveWorkflow(workflow: Workflow): void {
    this.execRun(`
      INSERT OR REPLACE INTO workflows (id, name, description, visual_proof, plan_file, repo_url, intermediate_repo_url, branch, on_finish, base_branch, parent_remote, feature_branch, merge_mode, review_provider, generation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      workflow.id, workflow.name,
      workflow.description ?? null,
      workflow.visualProof ? 1 : 0,
      workflow.planFile ?? null, workflow.repoUrl ?? null, workflow.intermediateRepoUrl ?? null, workflow.branch ?? null,
      workflow.onFinish ?? null, workflow.baseBranch ?? null, null, workflow.featureBranch ?? null,
      workflow.mergeMode ?? null,
      workflow.reviewProvider ?? null,
      workflow.generation ?? 0,
      workflow.createdAt, workflow.updatedAt,
    ]);
  }

  updateWorkflow(workflowId: string, changes: Partial<Pick<Workflow, 'name' | 'description' | 'visualProof' | 'planFile' | 'repoUrl' | 'intermediateRepoUrl' | 'branch' | 'onFinish' | 'baseBranch' | 'featureBranch' | 'mergeMode' | 'reviewProvider' | 'generation' | 'updatedAt'>>): void {
    const { setClauses, values } = buildWorkflowUpdate(changes);
    if (setClauses.length === 0) return;
    values.push(workflowId);
    this.execRun(`UPDATE workflows SET ${setClauses.join(', ')} WHERE id = ?`, values);
  }

  loadWorkflow(workflowId: string): Workflow | undefined {
    const row = this.queryOne('SELECT * FROM workflows WHERE id = ?', [workflowId]);
    if (!row) return undefined;
    const rollup = this.loadWorkflowRollups([workflowId]).get(workflowId);
    return this.rowToWorkflow(row, rollup);
  }

  listWorkflows(): Workflow[] {
    const rows = this.queryAll(
      'SELECT * FROM workflows ORDER BY created_at DESC',
    );
    const workflowIds = rows.map((row: any) => String(row.id));
    const rollups = this.loadWorkflowRollups(workflowIds);
    return rows.map((row: any) => this.rowToWorkflow(row, rollups.get(String(row.id))));
  }

  searchWorkflowsAndTasks(query: string, opts?: SearchOptions): SearchResultItem[] {
    if (!query.trim()) {
      return [];
    }
    const safeQuery = `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    const type = opts?.type ?? 'all';
    const limit = Math.min(opts?.limit ?? 20, 50);
    const offset = opts?.offset ?? 0;
    
    const results: SearchResultItem[] = [];
    
    if (type === 'workflows' || type === 'all') {
      const workflows = this.queryAll(
        `SELECT id, name, description, plan_file, repo_url, branch, created_at FROM workflows 
         WHERE name LIKE ? OR description LIKE ? OR plan_file LIKE ? OR repo_url LIKE ? OR branch LIKE ? 
         LIMIT ? OFFSET ?`,
        [safeQuery, safeQuery, safeQuery, safeQuery, safeQuery, limit, offset]
      ) as Array<{ id: string; name?: string | null; created_at: string }>;
      // Batch load rollups for status
      const workflowIds = workflows.map((row) => row.id);
      const rollups = workflowIds.length > 0 ? this.loadWorkflowRollups(workflowIds) : new Map();
      for (const row of workflows) {
        const rollup = rollups.get(row.id);
        const status = rollup?.status ?? 'pending';
        results.push({
          kind: 'workflow',
          id: row.id,
          workflowId: undefined,
          title: row.name || 'Unnamed workflow',
          subtitle: `Workflow · ${status}`,
          status,
          createdAt: row.created_at,
        });
      }
    }
    
    if (type === 'tasks' || type === 'all') {
      const tasks = this.queryAll(
        `SELECT id, workflow_id, description, command, prompt, summary, problem, approach, test_plan, repro_command, status, created_at FROM tasks 
         WHERE description LIKE ? OR command LIKE ? OR prompt LIKE ? OR summary LIKE ? OR problem LIKE ? OR approach LIKE ? OR test_plan LIKE ? OR repro_command LIKE ? 
         LIMIT ? OFFSET ?`,
        [safeQuery, safeQuery, safeQuery, safeQuery, safeQuery, safeQuery, safeQuery, safeQuery, limit, offset]
      ) as Array<{
        id: string;
        workflow_id?: string | null;
        description?: string | null;
        status?: string | null;
        created_at: string;
      }>;
      // Map workflow IDs to names for subtitle
      const workflowIds = [...new Set(tasks.map((task) => task.workflow_id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
      const workflowNameMap = new Map<string, string>();
      if (workflowIds.length > 0) {
        const placeholders = workflowIds.map(() => '?').join(',');
        const workflowRows = this.queryAll(
          `SELECT id, name FROM workflows WHERE id IN (${placeholders})`,
          workflowIds
        ) as Array<{ id: string; name?: string | null }>;
        for (const wf of workflowRows) {
          workflowNameMap.set(wf.id, wf.name || 'Unnamed workflow');
        }
      }
      for (const row of tasks) {
        const workflowName = row.workflow_id ? workflowNameMap.get(row.workflow_id) : undefined;
        results.push({
          kind: 'task',
          id: row.id,
          workflowId: row.workflow_id || undefined,
          title: row.description || 'Unnamed task',
          subtitle: workflowName ? `Task · ${workflowName}` : '',
          status: row.status || '',
          createdAt: row.created_at,
        });
      }
    }
    
    // Return workflows first, then tasks (preserving order within each category)
    return results;
  }

  loadWorkflowTaskSnapshot(): WorkflowTaskSnapshot {
    const totalStartedAt = Date.now();
    const workflowQueryStartedAt = Date.now();
    const workflowRows = this.queryAll('SELECT * FROM workflows ORDER BY created_at DESC');
    const workflowMetadataQueryMs = Date.now() - workflowQueryStartedAt;
    const taskQueryStartedAt = Date.now();
    const taskRows = this.queryAll('SELECT * FROM tasks ORDER BY workflow_id ASC, id ASC');
    const taskQueryMs = Date.now() - taskQueryStartedAt;
    const tasksByWorkflowId = new Map<string, TaskState[]>();
    const workflowIds = workflowRows.map((row: any) => String(row.id));
    const rollupStartedAt = Date.now();
    const rollups = this.computeWorkflowRollupsFromRows(workflowIds, taskRows);
    const rollupComputationMs = Date.now() - rollupStartedAt;
    const tasks: TaskState[] = [];

    const deserializeStartedAt = Date.now();
    for (const row of taskRows) {
      const task = this.reconcileTaskFromSelectedAttempt(this.rowToTask(row));
      tasks.push(task);
      const workflowId = task.config.workflowId ?? '';
      if (!workflowId) continue;
      const workflowTasks = tasksByWorkflowId.get(workflowId) ?? [];
      workflowTasks.push(task);
      tasksByWorkflowId.set(workflowId, workflowTasks);
    }
    const taskDeserializeReconcileMs = Date.now() - deserializeStartedAt;

    const snapshot = {
      workflows: workflowRows.map((row: any) => this.rowToWorkflow(row, rollups.get(String(row.id)))),
      tasks,
      tasksByWorkflowId,
    };
    this.lastWorkflowTaskSnapshotStats = {
      workflowMetadataQueryMs,
      taskQueryMs,
      rollupComputationMs,
      taskDeserializeReconcileMs,
      totalMs: Date.now() - totalStartedAt,
      workflowCount: snapshot.workflows.length,
      taskCount: tasks.length,
    };
    return snapshot;
  }

  getLastWorkflowTaskSnapshotStats(): Record<string, unknown> | null {
    return this.lastWorkflowTaskSnapshotStats ? { ...this.lastWorkflowTaskSnapshotStats } : null;
  }

  // ── Tasks ─────────────────────────────────────────────

  saveTask(workflowId: string, task: TaskState): void {
    const cfg = task.config;
    const exec = task.execution;
    this.execRun(`
      INSERT OR REPLACE INTO tasks (
        id, workflow_id, description, status, blocked_by, dependencies,
        command, prompt, experiment_prompt, exit_code, error, protocol_error_code, protocol_error_message, input_prompt, external_dependencies,
        summary, problem, approach, test_plan, repro_command, fix_prompt, fix_context,
        branch, commit_hash, fixed_integration_sha, fixed_integration_recorded_at, fixed_integration_source, parent_task,
        pivot, experiment_variants, is_reconciliation, selected_experiment,
        selected_experiments, experiment_results, requires_manual_approval,
        repo_url, feature_branch,
        is_merge_node, auto_fix, max_fix_attempts,
        runner_kind, pool_id, agent_session_id, workspace_path, container_id,
        last_agent_session_id, last_agent_name,
        action_request_id, experiments,
        created_at, launch_phase, launch_started_at, launch_completed_at, started_at, completed_at, last_heartbeat_at,
        utilization, pending_fix_error,
        review_url, review_id, review_status, review_provider_id,
        is_fixing_with_ai,
        execution_generation,
        pool_member_id,
        docker_image,
        execution_agent,
        agent_name,
        task_state_version
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `, [
      task.id, workflowId, task.description, task.status,
      exec.blockedBy ?? null,
      JSON.stringify(task.dependencies),
      cfg.command ?? null, cfg.prompt ?? null, cfg.experimentPrompt ?? null,
      exec.exitCode ?? null, exec.error ?? null, exec.protocolErrorCode ?? null, exec.protocolErrorMessage ?? null, exec.inputPrompt ?? null,
      cfg.externalDependencies ? JSON.stringify(cfg.externalDependencies) : null,
      cfg.summary ?? null, cfg.problem ?? null, cfg.approach ?? null,
      cfg.testPlan ?? null, cfg.reproCommand ?? null, cfg.fixPrompt ?? null, cfg.fixContext ?? null,
      exec.branch ?? null,
      exec.commit ?? null,
      exec.fixedIntegrationSha ?? null,
      exec.fixedIntegrationRecordedAt?.toISOString() ?? null,
      exec.fixedIntegrationSource ?? null,
      cfg.parentTask ?? null,
      cfg.pivot ? 1 : 0,
      cfg.experimentVariants ? JSON.stringify(cfg.experimentVariants) : null,
      cfg.isReconciliation ? 1 : 0,
      exec.selectedExperiment ?? null,
      exec.selectedExperiments ? JSON.stringify(exec.selectedExperiments) : null,
      exec.experimentResults ? JSON.stringify(exec.experimentResults) : null,
      cfg.requiresManualApproval ? 1 : 0,
      null, cfg.featureBranch ?? null,
      cfg.isMergeNode ? 1 : 0,
      0, null,
      cfg.runnerKind ?? null,
      cfg.poolId ?? null,
      exec.agentSessionId ?? null,
      exec.workspacePath ?? null,
      exec.containerId ?? null,
      exec.lastAgentSessionId ?? null,
      exec.lastAgentName ?? null,
      exec.actionRequestId ?? null,
      exec.experiments ? JSON.stringify(exec.experiments) : null,
      task.createdAt.toISOString(),
      exec.phase ?? null,
      exec.launchStartedAt?.toISOString() ?? null,
      exec.launchCompletedAt?.toISOString() ?? null,
      exec.startedAt?.toISOString() ?? null,
      exec.completedAt?.toISOString() ?? null,
      exec.lastHeartbeatAt?.toISOString() ?? null,
      null,
      exec.pendingFixError ?? null,
      exec.reviewUrl ?? null,
      exec.reviewId ?? null,
      exec.reviewStatus ?? null,
      exec.reviewProviderId ?? null,
      exec.isFixingWithAI ? 1 : 0,
      exec.generation ?? 0,
      (cfg as { poolMemberId?: string }).poolMemberId ?? null,
      cfg.dockerImage ?? null,
      cfg.executionAgent ?? null,
      exec.agentName ?? null,
      task.taskStateVersion ?? 1,
    ]);
  }

  updateTask(taskId: string, changes: TaskStateChanges): void {
    const { setClauses, values } = buildTaskUpdate(changes);
    if (setClauses.length === 0) return;


    if (changes.execution && 'workspacePath' in changes.execution) {
      try {
        const row = this.queryOne(
          'SELECT is_merge_node AS isMerge, workspace_path AS prevPath FROM tasks WHERE id = ?',
          [taskId],
        ) as { isMerge?: number; prevPath?: string | null } | undefined;
        if (row?.isMerge === 1) {
          const nextWs = (changes.execution as { workspacePath?: string }).workspacePath;
          console.log(
            `[merge-gate-workspace] sqlite.updateTask mergeNode task=${taskId} ` +
              `workspace_path ${row.prevPath ?? 'NULL'} → ${nextWs ?? 'NULL'} ` +
              '(caller sets executor worktree path and/or gate clone path)',
          );
        }
      } catch {
        /* best-effort diagnostics only */
      }
    }

    values.push(taskId);
    const heartbeatOnly =
      setClauses.length === 1 && setClauses[0].trimStart().startsWith('last_heartbeat_at =');
    if (!heartbeatOnly && process.env.NODE_ENV !== 'test' && process.env.INVOKER_TRACE_PERSIST_SQL === '1') {
      const cols = setClauses.map((c) => c.split(/\s*=\s*/)[0]!.trim()).join(', ');
      console.log(`[persist-sql] taskId=${taskId} columns=[${cols}]`);
    }
    this.execRun(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`, values);
  }

  loadTasks(workflowId: string): TaskState[] {
    const rows = this.queryAll('SELECT * FROM tasks WHERE workflow_id = ?', [workflowId]);
    return rows.map((row) => this.reconcileTaskFromSelectedAttempt(this.rowToTask(row)));
  }

  loadTask(taskId: string): TaskState | undefined {
    const row = this.queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!row) return undefined;
    return this.reconcileTaskFromSelectedAttempt(this.rowToTask(row));
  }

  getAllTaskIds(): string[] {
    const rows = this.queryAll('SELECT id FROM tasks') as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  getAllTaskBranches(): string[] {
    const rows = this.queryAll(
      'SELECT DISTINCT branch FROM tasks WHERE branch IS NOT NULL',
    ) as Array<{ branch: string }>;
    return rows.map((r) => r.branch);
  }

  private getTaskIdsForWorkflow(workflowId: string): string[] {
    const rows = this.queryAll(
      'SELECT id FROM tasks WHERE workflow_id = ?',
      [workflowId],
    ) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private invalidateOutputTailCache(taskIds: string[]): void {
    for (const taskId of taskIds) {
      this.outputTailCache.delete(taskId);
      this.spoolNextOffsetCache.delete(taskId);
    }
  }

  private taskOutputKey(taskId: string): string {
    return createHash('sha256').update(taskId).digest('hex');
  }

  private taskOutputFile(taskId: string): string {
    return join(this.outputDir, 'full', `${this.taskOutputKey(taskId)}.log`);
  }

  private taskSpoolFile(taskId: string): string {
    return join(this.outputDir, 'spool', `${this.taskOutputKey(taskId)}.jsonl`);
  }

  private ensureOutputSubdir(kind: 'full' | 'spool'): void {
    mkdirSync(join(this.outputDir, kind), { recursive: true });
  }

  private removeOutputFiles(taskIds: string[]): void {
    for (const taskId of taskIds) {
      rmSync(this.taskOutputFile(taskId), { force: true });
      rmSync(this.taskSpoolFile(taskId), { force: true });
    }
    this.invalidateOutputTailCache(taskIds);
  }

  private readTaskOutputFile(taskId: string): string {
    const file = this.taskOutputFile(taskId);
    if (!existsSync(file)) return '';
    return readFileSync(file, 'utf8');
  }

  private encodeSpoolLine(chunk: OutputChunk): string {
    const data = Buffer.from(chunk.data, 'utf8').toString('base64');
    return `${chunk.offset}\t${data}\n`;
  }

  private decodeSpoolLine(line: string): OutputChunk | null {
    if (!line) return null;
    const separator = line.indexOf('\t');
    if (separator <= 0) return null;
    const offset = Number.parseInt(line.slice(0, separator), 10);
    if (!Number.isFinite(offset)) return null;
    return {
      offset,
      data: Buffer.from(line.slice(separator + 1), 'base64').toString('utf8'),
    };
  }

  private readSpoolLines(taskId: string): OutputChunk[] {
    const file = this.taskSpoolFile(taskId);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => this.decodeSpoolLine(line))
      .filter((chunk): chunk is OutputChunk => chunk !== null);
  }

  private readLastSpoolLines(taskId: string, limit: number): OutputChunk[] {
    if (limit <= 0) return [];
    const file = this.taskSpoolFile(taskId);
    if (!existsSync(file)) return [];

    const fd = openSync(file, 'r');
    try {
      const size = statSync(file).size;
      const chunkSize = 64 * 1024;
      let position = size;
      let suffix = '';
      let lines: string[] = [];

      while (position > 0 && lines.length <= limit) {
        const readSize = Math.min(chunkSize, position);
        position -= readSize;
        const buffer = Buffer.allocUnsafe(readSize);
        readSync(fd, buffer, 0, readSize, position);
        const text = buffer.toString('utf8') + suffix;
        const parts = text.split('\n');
        suffix = parts.shift() ?? '';
        lines = parts.concat(lines);
      }
      if (position === 0 && suffix) {
        lines.unshift(suffix);
      }

      return lines
        .filter(Boolean)
        .slice(-limit)
        .map((line) => this.decodeSpoolLine(line))
        .filter((chunk): chunk is OutputChunk => chunk !== null);
    } finally {
      closeSync(fd);
    }
  }

  private readLastSpoolChunk(taskId: string): OutputChunk | null {
    return this.readLastSpoolLines(taskId, 1)[0] ?? null;
  }

  private getLegacySpoolChunks(taskId: string): OutputChunk[] {
    const rows = this.queryAll(
      'SELECT offset, data FROM output_spool WHERE task_id = ? ORDER BY offset ASC',
      [taskId],
    ) as Array<{ offset: number; data: string }>;

    return rows.map((row) => ({ offset: row.offset, data: row.data }));
  }

  private getLegacySpoolEndOffset(taskId: string): number {
    const row = this.queryOne(
      'SELECT offset, data FROM output_spool WHERE task_id = ? ORDER BY offset DESC LIMIT 1',
      [taskId],
    ) as { offset: number; data: string } | undefined;
    if (!row) return 0;
    return row.offset + Buffer.byteLength(row.data, 'utf8');
  }

  private getNextSpoolOffset(taskId: string): number {
    const cached = this.spoolNextOffsetCache.get(taskId);
    if (cached !== undefined) return cached;

    const legacyEnd = this.getLegacySpoolEndOffset(taskId);
    const fileLast = this.readLastSpoolChunk(taskId);
    const fileEnd = fileLast ? fileLast.offset + Buffer.byteLength(fileLast.data, 'utf8') : 0;
    const nextOffset = Math.max(legacyEnd, fileEnd);
    this.spoolNextOffsetCache.set(taskId, nextOffset);
    return nextOffset;
  }

  loadAllCompletedTasks(): Array<TaskState & { workflowName: string }> {
    const rows = this.queryAll(`
      SELECT t.*, w.name AS workflow_name
      FROM tasks t
      JOIN workflows w ON w.id = t.workflow_id
      WHERE t.status = 'completed'
      ORDER BY t.completed_at DESC
    `);
    return rows.map((row: any) => ({
      ...this.rowToTask(row),
      workflowName: row.workflow_name,
    }));
  }

  deleteAllTasks(workflowId: string): void {
    const taskIds = this.getTaskIdsForWorkflow(workflowId);
    this.runTransaction(() => {
      this.db.run('DELETE FROM workflow_mutation_leases WHERE workflow_id = ?', [workflowId]);
      this.db.run('DELETE FROM workflow_mutation_intents WHERE workflow_id = ?', [workflowId]);
      this.db.run('DELETE FROM task_launch_dispatch WHERE workflow_id = ?', [workflowId]);
      this.db.run(`
        DELETE FROM events WHERE task_id IN (
          SELECT id FROM tasks WHERE workflow_id = ?
        )
      `, [workflowId]);
      this.db.run(`
        DELETE FROM task_output WHERE task_id IN (
          SELECT id FROM tasks WHERE workflow_id = ?
        )
      `, [workflowId]);
      this.db.run(`
        DELETE FROM attempts WHERE node_id IN (
          SELECT id FROM tasks WHERE workflow_id = ?
        )
      `, [workflowId]);
      this.db.run(`
        DELETE FROM output_spool WHERE task_id IN (
          SELECT id FROM tasks WHERE workflow_id = ?
        )
      `, [workflowId]);
      this.db.run('DELETE FROM tasks WHERE workflow_id = ?', [workflowId]);
    });
    this.removeOutputFiles(taskIds);
  }

  deleteAllWorkflows(): void {
    const taskIds = this.getAllTaskIds();
    this.runTransaction(() => {
      this.db.run('DELETE FROM workflow_mutation_leases');
      this.db.run('DELETE FROM workflow_mutation_intents');
      this.db.run('DELETE FROM task_launch_dispatch');
      this.db.run('DELETE FROM events');
      this.db.run('DELETE FROM task_output');
      this.db.run('DELETE FROM attempts');
      this.db.run('DELETE FROM output_spool');
      this.db.run('DELETE FROM tasks');
      this.db.run('DELETE FROM workflows');
    });
    this.removeOutputFiles(taskIds);
    this.outputTailCache.clear();
    this.spoolNextOffsetCache.clear();
  }

  deleteWorkflow(workflowId: string): void {
    const taskIds = this.getTaskIdsForWorkflow(workflowId);
    this.runTransaction(() => {
      this.db.run('DELETE FROM workflow_mutation_leases WHERE workflow_id = ?', [workflowId]);
      this.db.run('DELETE FROM workflow_mutation_intents WHERE workflow_id = ?', [workflowId]);
      this.db.run('DELETE FROM task_launch_dispatch WHERE workflow_id = ?', [workflowId]);

      this.db.run(`
        DELETE FROM events WHERE task_id IN (
          SELECT id FROM tasks WHERE workflow_id = ?
        )
      `, [workflowId]);

      this.db.run(`
        DELETE FROM task_output WHERE task_id IN (
          SELECT id FROM tasks WHERE workflow_id = ?
        )
      `, [workflowId]);

      this.db.run(`
        DELETE FROM attempts WHERE node_id IN (
          SELECT id FROM tasks WHERE workflow_id = ?
        )
      `, [workflowId]);

      this.db.run(`
        DELETE FROM output_spool WHERE task_id IN (
          SELECT id FROM tasks WHERE workflow_id = ?
        )
      `, [workflowId]);

      this.db.run('DELETE FROM tasks WHERE workflow_id = ?', [workflowId]);

      this.db.run('DELETE FROM workflows WHERE id = ?', [workflowId]);
    });
    this.removeOutputFiles(taskIds);
  }

  // ── Events ────────────────────────────────────────────

  logEvent(taskId: string, eventType: string, payload?: unknown): void {
    this.execRun(`
      INSERT INTO events (task_id, event_type, payload)
      VALUES (?, ?, ?)
    `, [taskId, eventType, payload ? JSON.stringify(payload) : null]);
  }

  getEvents(taskId: string): TaskEvent[] {
    const rows = this.queryAll(
      'SELECT * FROM events WHERE task_id = ? ORDER BY id ASC',
      [taskId],
    );
    return rows.map((row: any) => ({
      id: row.id,
      taskId: row.task_id,
      eventType: row.event_type,
      payload: row.payload ?? undefined,
      createdAt: row.created_at,
    }));
  }

  // ── Queries ─────────────────────────────────────────

  getSelectedExperiment(taskId: string): string | null {
    const row = this.queryOne(
      'SELECT selected_experiment FROM tasks WHERE id = ?',
      [taskId],
    );
    return (row?.selected_experiment as string) ?? null;
  }

  getWorkspacePath(taskId: string): string | null {
    const row = this.queryOne(
      'SELECT workspace_path FROM tasks WHERE id = ?',
      [taskId],
    );
    return (row?.workspace_path as string) ?? null;
  }

  getAgentSessionId(taskId: string): string | null {
    const row = this.queryOne(
      'SELECT agent_session_id, last_agent_session_id FROM tasks WHERE id = ?',
      [taskId],
    );
    const val = ((row?.agent_session_id as string) ?? (row?.last_agent_session_id as string) ?? null);
    return val === 'none' ? null : val;
  }

  getLastAgentSessionId(taskId: string): string | null {
    const row = this.queryOne(
      'SELECT last_agent_session_id FROM tasks WHERE id = ?',
      [taskId],
    );
    const val = (row?.last_agent_session_id as string) ?? null;
    return val === 'none' ? null : val;
  }

  getRunnerKind(taskId: string): string | null {
    const row = this.queryOne(
      'SELECT runner_kind FROM tasks WHERE id = ?',
      [taskId],
    );
    const raw = (row?.runner_kind as string) ?? null;
    if (raw === null) return null;
    return normalizeRunnerKind(raw) ?? raw;
  }

  getTaskStatus(taskId: string): string | null {
    const row = this.queryOne(
      'SELECT status FROM tasks WHERE id = ?',
      [taskId],
    ) as { status?: string } | undefined;
    if (!row?.status) return null;
    return row.status;
  }

  getContainerId(taskId: string): string | null {
    const row = this.queryOne(
      'SELECT container_id FROM tasks WHERE id = ?',
      [taskId],
    );
    const val = (row?.container_id as string) ?? null;
    return val === 'none' ? null : val;
  }

  getBranch(taskId: string): string | null {
    const row = this.queryOne(
      'SELECT branch FROM tasks WHERE id = ?',
      [taskId],
    );
    return (row?.branch as string) ?? null;
  }

  getExecutionAgent(taskId: string): string | null {
    const row = this.queryOne(
      `
      SELECT
        CASE
          WHEN prompt IS NOT NULL AND TRIM(prompt) != '' THEN COALESCE(execution_agent, agent_name)
          ELSE COALESCE(agent_name, execution_agent)
        END AS agent
      FROM tasks
      WHERE id = ?
      `,
      [taskId],
    );
    return (row?.agent as string) ?? null;
  }

  getPoolMemberId(taskId: string): string | null {
    const row = this.queryOne(
      'SELECT pool_member_id FROM tasks WHERE id = ?',
      [taskId],
    );
    return (row?.pool_member_id as string) ?? null;
  }

  // ── Conversations ───────────────────────────────────────

  saveConversation(conversation: Conversation): void {
    this.execRun(`
      INSERT OR REPLACE INTO conversations (thread_ts, channel_id, user_id, extracted_plan, plan_submitted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      conversation.threadTs,
      conversation.channelId,
      conversation.userId,
      conversation.extractedPlan,
      conversation.planSubmitted ? 1 : 0,
      conversation.createdAt,
      conversation.updatedAt,
    ]);
  }

  loadConversation(threadTs: string): Conversation | undefined {
    const row = this.queryOne('SELECT * FROM conversations WHERE thread_ts = ?', [threadTs]);
    if (!row) return undefined;
    return {
      threadTs: row.thread_ts as string,
      channelId: row.channel_id as string,
      userId: row.user_id as string,
      extractedPlan: (row.extracted_plan as string) ?? null,
      planSubmitted: row.plan_submitted === 1,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  updateConversation(threadTs: string, changes: Partial<Pick<Conversation, 'extractedPlan' | 'planSubmitted' | 'updatedAt'>>): void {
    const setClauses: string[] = [];
    const values: any[] = [];

    if ('extractedPlan' in changes) {
      setClauses.push('extracted_plan = ?');
      values.push(changes.extractedPlan ?? null);
    }
    if ('planSubmitted' in changes) {
      setClauses.push('plan_submitted = ?');
      values.push(changes.planSubmitted ? 1 : 0);
    }

    // Always bump updated_at
    setClauses.push('updated_at = ?');
    values.push(changes.updatedAt ?? new Date().toISOString());

    if (setClauses.length === 0) return;
    values.push(threadTs);
    this.execRun(`UPDATE conversations SET ${setClauses.join(', ')} WHERE thread_ts = ?`, values);
  }

  deleteConversation(threadTs: string): void {
    this.execRun('DELETE FROM conversation_messages WHERE thread_ts = ?', [threadTs]);
    this.execRun('DELETE FROM conversations WHERE thread_ts = ?', [threadTs]);
  }

  listActiveConversations(): Conversation[] {
    const rows = this.queryAll(
      'SELECT * FROM conversations WHERE plan_submitted = 0 ORDER BY updated_at DESC',
    );
    return rows.map((row: any) => ({
      threadTs: row.thread_ts as string,
      channelId: row.channel_id as string,
      userId: row.user_id as string,
      extractedPlan: (row.extracted_plan as string) ?? null,
      planSubmitted: row.plan_submitted === 1,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  deleteConversationsOlderThan(cutoffIso: string): number {
    this.ensureWritable();
    // Delete messages first (FK constraint)
    this.db.run(`
      DELETE FROM conversation_messages WHERE thread_ts IN (
        SELECT thread_ts FROM conversations WHERE updated_at < ?
      )
    `, [cutoffIso]);
    this.db.run(
      'DELETE FROM conversations WHERE updated_at < ?',
      [cutoffIso],
    );
    const changes = this.db.getRowsModified();
    this.dirty = true;
    return changes;
  }

  // ── Conversation Messages ──────────────────────────────

  appendMessage(threadTs: string, role: 'user' | 'assistant', content: string): void {
    const row = this.queryOne(
      'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM conversation_messages WHERE thread_ts = ?',
      [threadTs],
    ) as { max_seq: number } | undefined;
    const nextSeq = ((row?.max_seq as number) ?? 0) + 1;

    this.execRun(`
      INSERT INTO conversation_messages (thread_ts, seq, role, content)
      VALUES (?, ?, ?, ?)
    `, [threadTs, nextSeq, role, content]);
  }

  loadMessages(threadTs: string): ConversationMessage[] {
    const rows = this.queryAll(
      'SELECT * FROM conversation_messages WHERE thread_ts = ? ORDER BY seq ASC',
      [threadTs],
    );
    return rows.map((row: any) => ({
      id: row.id,
      threadTs: row.thread_ts,
      seq: row.seq,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  // ── Task Output ─────────────────────────────────────

  appendTaskOutput(taskId: string, data: string): void {
    this.ensureWritable();
    this.ensureOutputSubdir('full');
    appendFileSync(this.taskOutputFile(taskId), data, 'utf8');
  }

  getTaskOutput(taskId: string): string {
    // Prefer the output spool (DB + file) when it has any chunks for this task —
    // it is the canonical streaming-output store. Otherwise fall back to
    // task_output (legacy DB rows + diagnostic file), which avoids returning a
    // duplicated stream when both stores contain the same data.
    const spoolChunks = this.getOutputChunks(taskId);
    if (spoolChunks.length > 0) {
      return spoolChunks.map((chunk) => chunk.data).join('');
    }
    const rows = this.queryAll(
      'SELECT data FROM task_output WHERE task_id = ? ORDER BY id ASC',
      [taskId],
    ) as Array<{ data: string }>;
    return rows.map((r) => r.data).join('') + this.readTaskOutputFile(taskId);
  }

  /**
   * Maintenance: delete task_output rows for tasks that already have output_spool
   * rows. Diagnostic-only task_output rows for tasks with no output_spool rows
   * are preserved. Writes a DB backup before mutating unless `backup: false` is
   * passed. Returns the number of rows deleted and the backup path used (or
   * null for in-memory databases or when `backup: false`).
   */
  pruneDuplicateTaskOutputRows(options?: { backup?: boolean; backupPath?: string }): {
    deletedTaskOutputRows: number;
    backupPath: string | null;
  } {
    this.ensureWritable();

    let backupPath: string | null = null;
    const shouldBackup = options?.backup !== false;
    if (shouldBackup && this.dbPath) {
      backupPath = options?.backupPath ?? `${this.dbPath}.prune-backup-${Date.now()}`;
      if (!existsSync(backupPath)) {
        const dir = dirname(backupPath);
        mkdirSync(dir, { recursive: true });
        this.checkpointWal('FULL');
        this.nativeDb.exec(`VACUUM INTO ${sqlStringLiteral(backupPath)}`);
      }
    }

    const before = this.queryOne('SELECT COUNT(*) AS c FROM task_output') as
      | { c: number }
      | undefined;
    const beforeCount = Number(before?.c ?? 0);

    this.runTransaction(() => {
      this.db.run(`
        DELETE FROM task_output
        WHERE task_id IN (
          SELECT DISTINCT task_id FROM output_spool
        )
      `);
    });

    const after = this.queryOne('SELECT COUNT(*) AS c FROM task_output') as
      | { c: number }
      | undefined;
    const afterCount = Number(after?.c ?? 0);
    return {
      deletedTaskOutputRows: Math.max(0, beforeCount - afterCount),
      backupPath,
    };
  }

  // ── Output Spool ────────────────────────────────────────

  appendOutputChunk(taskId: string, data: string): void {
    this.ensureWritable();
    const nextOffset = this.getNextSpoolOffset(taskId);
    this.ensureOutputSubdir('spool');
    appendFileSync(this.taskSpoolFile(taskId), this.encodeSpoolLine({ offset: nextOffset, data }), 'utf8');
    this.spoolNextOffsetCache.set(taskId, nextOffset + Buffer.byteLength(data, 'utf8'));

    // Update in-memory tail cache
    const tail = this.outputTailCache.get(taskId) ?? [];
    tail.push({ offset: nextOffset, data });

    // Keep only the last N chunks in memory
    if (tail.length > this.outputTailLimit) {
      tail.shift();
    }
    this.outputTailCache.set(taskId, tail);
  }

  getOutputChunks(taskId: string): OutputChunk[] {
    return [...this.getLegacySpoolChunks(taskId), ...this.readSpoolLines(taskId)]
      .sort((a, b) => a.offset - b.offset);
  }

  replayOutputFrom(taskId: string, fromOffset: number): OutputChunk[] {
    const legacyRows = this.queryAll(
      'SELECT offset, data FROM output_spool WHERE task_id = ? AND offset >= ? ORDER BY offset ASC',
      [taskId, fromOffset],
    ) as Array<{ offset: number; data: string }>;

    const legacyChunks = legacyRows.map((row) => ({ offset: row.offset, data: row.data }));
    const fileChunks = this.readSpoolLines(taskId).filter((chunk) => chunk.offset >= fromOffset);
    return [...legacyChunks, ...fileChunks].sort((a, b) => a.offset - b.offset);
  }

  getOutputTail(taskId: string): OutputChunk[] {
    // Return from cache if available
    const cached = this.outputTailCache.get(taskId);
    if (cached && cached.length > 0) {
      return cached;
    }

    const legacyRows = this.queryAll(
      `SELECT offset, data FROM output_spool
       WHERE task_id = ?
       ORDER BY offset DESC
       LIMIT ?`,
      [taskId, this.outputTailLimit],
    ) as Array<{ offset: number; data: string }>;

    const legacyChunks = legacyRows.map((row) => ({ offset: row.offset, data: row.data }));
    const fileChunks = this.readLastSpoolLines(taskId, this.outputTailLimit);
    const chunks = [...legacyChunks, ...fileChunks]
      .sort((a, b) => a.offset - b.offset)
      .slice(-this.outputTailLimit);

    // Populate cache
    if (chunks.length > 0) {
      this.outputTailCache.set(taskId, chunks);
    }

    return chunks;
  }

  // ── Attempts ────────────────────────────────────────────

  saveAttempt(attempt: Attempt): void {
    this.execRun(`
      INSERT OR REPLACE INTO attempts (
        id, node_id, attempt_number, queue_priority, status,
        snapshot_commit, base_branch, upstream_attempt_ids,
        command_override, prompt_override,
        claimed_at, started_at, completed_at, exit_code, error, last_heartbeat_at, lease_expires_at,
        branch, commit_hash, summary, workspace_path, agent_session_id, container_id,
        supersedes_attempt_id, created_at, merge_conflict
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `, [
      attempt.id, attempt.nodeId, 0, attempt.queuePriority, attempt.status,
      attempt.snapshotCommit ?? null, attempt.baseBranch ?? null,
      JSON.stringify(attempt.upstreamAttemptIds),
      attempt.commandOverride ?? null, attempt.promptOverride ?? null,
      attempt.claimedAt?.toISOString() ?? null,
      attempt.startedAt?.toISOString() ?? null,
      attempt.completedAt?.toISOString() ?? null,
      attempt.exitCode ?? null, attempt.error ?? null,
      attempt.lastHeartbeatAt?.toISOString() ?? null,
      attempt.leaseExpiresAt?.toISOString() ?? null,
      attempt.branch ?? null, attempt.commit ?? null, attempt.summary ?? null,
      attempt.workspacePath ?? null, attempt.agentSessionId ?? null,
      attempt.containerId ?? null,
      attempt.supersedesAttemptId ?? null,
      attempt.createdAt.toISOString(),
      attempt.mergeConflict ? JSON.stringify(attempt.mergeConflict) : null,
    ]);
  }

  loadAttempts(nodeId: string): Attempt[] {
    const rows = this.queryAll(
      'SELECT * FROM attempts WHERE node_id = ? ORDER BY created_at ASC',
      [nodeId],
    );
    return rows.map(this.rowToAttempt);
  }

  loadAttempt(attemptId: string): Attempt | undefined {
    const row = this.queryOne(
      'SELECT * FROM attempts WHERE id = ?',
      [attemptId],
    );
    if (!row) return undefined;
    return this.rowToAttempt(row);
  }

  updateAttempt(attemptId: string, changes: Partial<Pick<Attempt, 'status' | 'claimedAt' | 'startedAt' | 'completedAt' | 'exitCode' | 'error' | 'lastHeartbeatAt' | 'leaseExpiresAt' | 'branch' | 'commit' | 'summary' | 'queuePriority' | 'workspacePath' | 'agentSessionId' | 'containerId' | 'mergeConflict'>>): void {
    const { setClauses, values } = buildAttemptUpdate(changes);
    if (setClauses.length === 0) return;
    values.push(attemptId);
    this.execRun(`UPDATE attempts SET ${setClauses.join(', ')} WHERE id = ?`, values);
  }

  claimAttemptForLaunch(
    attemptId: string,
    changes: Partial<Pick<Attempt, 'status' | 'claimedAt' | 'startedAt' | 'lastHeartbeatAt' | 'leaseExpiresAt' | 'queuePriority'>>,
    now: Date,
  ): boolean {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (changes.status !== undefined) { setClauses.push('status = ?'); values.push(changes.status); }
    if (changes.claimedAt !== undefined) { setClauses.push('claimed_at = ?'); values.push(changes.claimedAt instanceof Date ? changes.claimedAt.toISOString() : changes.claimedAt ?? null); }
    if (changes.startedAt !== undefined) { setClauses.push('started_at = ?'); values.push(changes.startedAt instanceof Date ? changes.startedAt.toISOString() : changes.startedAt ?? null); }
    if (changes.lastHeartbeatAt !== undefined) { setClauses.push('last_heartbeat_at = ?'); values.push(changes.lastHeartbeatAt instanceof Date ? changes.lastHeartbeatAt.toISOString() : changes.lastHeartbeatAt ?? null); }
    if (changes.leaseExpiresAt !== undefined) { setClauses.push('lease_expires_at = ?'); values.push(changes.leaseExpiresAt instanceof Date ? changes.leaseExpiresAt.toISOString() : changes.leaseExpiresAt ?? null); }
    if (changes.queuePriority !== undefined) { setClauses.push('queue_priority = ?'); values.push(changes.queuePriority); }

    if (setClauses.length === 0) return false;
    values.push(attemptId, now.toISOString());
    this.ensureWritable();
    this.db.run(
      `UPDATE attempts SET ${setClauses.join(', ')}
       WHERE id = ?
         AND (
           status = 'pending'
           OR (
             status IN ('claimed', 'running')
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?
           )
         )`,
      values,
    );
    const claimed = this.db.getRowsModified() > 0;
    if (claimed) {
      this.dirty = true;
    }
    return claimed;
  }

  failTaskAndAttempt(
    taskId: string,
    taskChanges: TaskStateChanges,
    attemptPatch: Partial<Pick<Attempt, 'status' | 'exitCode' | 'error' | 'completedAt'>>
  ): void {
    this.runTransaction(() => {
      // Update task state
      this.updateTask(taskId, taskChanges);

      // Load the latest attempt for this task
      const row = this.queryOne(
        'SELECT id, status FROM attempts WHERE node_id = ? ORDER BY created_at DESC LIMIT 1',
        [taskId],
      ) as { id: string; status: string } | undefined;

      // If there's an active attempt, update it with the failure details.
      // Claimed is included because launch-time failures can happen before
      // the attempt reaches persisted running state.
      if (row && (row.status === 'running' || row.status === 'claimed')) {
        this.updateAttempt(row.id, attemptPatch);
      }
    });
  }

  // ── Activity Log ─────────────────────────────────────

  writeActivityLog(source: string, level: string, message: string): void {
    this.execRun(
      'INSERT INTO activity_log (source, level, message) VALUES (?, ?, ?)',
      [source, level, message],
    );
  }

  getActivityLogs(sinceId = 0, limit = 200): ActivityLogEntry[] {
    const rows = this.queryAll(
      'SELECT * FROM activity_log WHERE id > ? ORDER BY id ASC LIMIT ?',
      [sinceId, limit],
    );
    return rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      source: row.source,
      level: row.level,
      message: row.message,
    }));
  }

  // ── Lifecycle ─────────────────────────────────────────

  close(): void {
    if (this.dbPath && !this.readOnly) {
      this.checkpointWal('PASSIVE');
    }
    this.db.close();
  }

  // ── Helpers ───────────────────────────────────────────

  private loadWorkflowRollups(workflowIds: string[]): Map<string, WorkflowRollup> {
    const rollups = new Map<string, WorkflowRollup>();
    if (workflowIds.length === 0) return rollups;

    const placeholders = workflowIds.map(() => '?').join(', ');
    const taskRows = this.queryAll(
      `SELECT id, workflow_id, description, status, dependencies, error, protocol_error_code, protocol_error_message,
              pending_fix_error, exit_code, completed_at, agent_session_id, agent_name,
              review_url, input_prompt, is_fixing_with_ai
       FROM tasks
       WHERE workflow_id IN (${placeholders})
       ORDER BY id ASC`,
      workflowIds,
    );

    return this.computeWorkflowRollupsFromRows(workflowIds, taskRows);
  }

  private computeWorkflowRollupsFromRows(
    workflowIds: string[],
    taskRows: Record<string, unknown>[],
  ): Map<string, WorkflowRollup> {
    return computeSQLiteWorkflowRollupsFromRows(workflowIds, taskRows);
  }

  private rowToWorkflow(row: any, rollup?: WorkflowRollup): Workflow {
    return rowToSQLiteWorkflow(row, rollup);
  }

  private rowToTask(row: any): TaskState {
    return rowToSQLiteTask(row);
  }

  private reconcileTaskFromSelectedAttempt(task: TaskState): TaskState {
    return reconcileSQLiteTaskFromSelectedAttempt(task, (attemptId) => this.loadAttempt(attemptId));
  }

  private rowToAttempt(row: any): Attempt {
    return rowToSQLiteAttempt(row);
  }

  enqueueWorkflowMutationIntent(
    workflowId: string,
    channel: string,
    args: unknown[],
    priority: WorkflowMutationPriority,
  ): number {
    this.execRun(
      `INSERT INTO workflow_mutation_intents (
        workflow_id, channel, args_json, priority, status
      ) VALUES (?, ?, ?, ?, 'queued')`,
      [workflowId, channel, JSON.stringify(args), priority],
    );
    const row = this.queryOne('SELECT last_insert_rowid() AS id');
    return Number(row?.id ?? 0);
  }

  evictQueuedWorkflowMutationIntentsBefore(
    workflowId: string,
    beforeIntentId: number,
    reason: string = 'Evicted by workflow reset boundary',
  ): number[] {
    const cutoff = Math.floor(beforeIntentId);
    if (!Number.isFinite(cutoff) || cutoff <= 0) {
      return [];
    }
    const rows = this.queryAll(
      `SELECT id
         FROM workflow_mutation_intents
        WHERE workflow_id = ?
          AND status = 'queued'
          AND id < ?`,
      [workflowId, cutoff],
    );
    const evictedIds = rows
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id));
    if (evictedIds.length === 0) {
      return [];
    }
    this.execRun(
      `UPDATE workflow_mutation_intents
          SET status = 'failed',
              completed_at = ?,
              error = ?
        WHERE workflow_id = ?
          AND status = 'queued'
          AND id < ?`,
      [new Date().toISOString(), reason, workflowId, cutoff],
    );
    return evictedIds;
  }

  loadWorkflowMutationIntent(id: number): WorkflowMutationIntent | undefined {
    const row = this.queryOne('SELECT * FROM workflow_mutation_intents WHERE id = ?', [id]);
    return row ? this.rowToWorkflowMutationIntent(row) : undefined;
  }

  listWorkflowMutationIntents(
    workflowId?: string,
    statuses?: WorkflowMutationIntentStatus[],
  ): WorkflowMutationIntent[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (workflowId) {
      where.push('workflow_id = ?');
      params.push(workflowId);
    }
    if (statuses && statuses.length > 0) {
      where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    const rows = this.queryAll(
      `SELECT * FROM workflow_mutation_intents ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ` +
        `ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END ASC, id ASC`,
      params,
    );
    return rows.map((row) => this.rowToWorkflowMutationIntent(row));
  }

  requeueRunningWorkflowMutationIntents(): number {
    const running = this.queryOne(
      `SELECT COUNT(*) AS count FROM workflow_mutation_intents WHERE status = 'running'`,
    );
    this.execRun(
      `UPDATE workflow_mutation_intents
         SET status = 'queued', owner_id = NULL, started_at = NULL, completed_at = NULL
       WHERE status = 'running'`,
    );
    return Number(running?.count ?? 0);
  }

  claimNextWorkflowMutationIntent(
    workflowId: string,
    ownerId: string,
  ): WorkflowMutationIntent | undefined {
    const next = this.queryOne(
      `SELECT * FROM workflow_mutation_intents
       WHERE workflow_id = ? AND status = 'queued'
       ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END ASC, id ASC
       LIMIT 1`,
      [workflowId],
    );
    if (!next) return undefined;
    this.execRun(
      `UPDATE workflow_mutation_intents
         SET status = 'running', owner_id = ?, started_at = ?, completed_at = NULL, error = NULL
       WHERE id = ? AND status = 'queued'`,
      [ownerId, new Date().toISOString(), next.id],
    );
    const claimed = this.queryOne('SELECT * FROM workflow_mutation_intents WHERE id = ?', [next.id]);
    if (!claimed || claimed.status !== 'running') return undefined;
    return this.rowToWorkflowMutationIntent(claimed);
  }

  claimWorkflowMutationLease(
    workflowId: string,
    ownerId: string,
    options?: { activeIntentId?: number; activeMutationKind?: string },
  ): boolean {
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKFLOW_MUTATION_LEASE_MS).toISOString();
    const existing = this.queryOne(
      'SELECT * FROM workflow_mutation_leases WHERE workflow_id = ?',
      [workflowId],
    );

    if (!existing) {
      this.execRun(
        `INSERT INTO workflow_mutation_leases (
          workflow_id, owner_id, active_intent_id, active_mutation_kind, leased_at, last_heartbeat_at, lease_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          workflowId,
          ownerId,
          options?.activeIntentId ?? null,
          options?.activeMutationKind ?? null,
          now,
          now,
          leaseExpiresAt,
        ],
      );
      return true;
    }

    const existingOwnerId = String(existing.owner_id);
    const existingExpiry = existing.lease_expires_at ? new Date(String(existing.lease_expires_at)).getTime() : 0;
    const isExpired = existingExpiry < Date.now();

    if (existingOwnerId !== ownerId && !isExpired) {
      return false;
    }

    if (isExpired) {
      this.requeueWorkflowMutationLease(workflowId);
    }

    this.execRun(
      `INSERT OR REPLACE INTO workflow_mutation_leases (
        workflow_id, owner_id, active_intent_id, active_mutation_kind, leased_at, last_heartbeat_at, lease_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        workflowId,
        ownerId,
        options?.activeIntentId ?? null,
        options?.activeMutationKind ?? null,
        now,
        now,
        leaseExpiresAt,
      ],
    );
    return true;
  }

  renewWorkflowMutationLease(
    workflowId: string,
    ownerId: string,
    options?: {
      activeIntentId?: number;
      activeMutationKind?: string;
      minHeartbeatIntervalMs?: number;
      minExpiryLeadMs?: number;
    },
  ): boolean {
    const lease = this.queryOne(
      'SELECT * FROM workflow_mutation_leases WHERE workflow_id = ?',
      [workflowId],
    );
    if (!lease || String(lease.owner_id) !== ownerId) {
      return false;
    }

    const nowMs = Date.now();
    const nextIntentId = options?.activeIntentId ?? null;
    const nextMutationKind = options?.activeMutationKind ?? null;
    const sameIntent = String(lease.active_intent_id ?? '') === String(nextIntentId ?? '');
    const sameKind = String(lease.active_mutation_kind ?? '') === String(nextMutationKind ?? '');
    const lastHeartbeatMs = lease.last_heartbeat_at ? Date.parse(String(lease.last_heartbeat_at)) : 0;
    const leaseExpiryMs = lease.lease_expires_at ? Date.parse(String(lease.lease_expires_at)) : 0;
    const minHeartbeatIntervalMs = options?.minHeartbeatIntervalMs ?? 0;
    const minExpiryLeadMs = options?.minExpiryLeadMs ?? 0;

    if (
      sameIntent &&
      sameKind &&
      minHeartbeatIntervalMs > 0 &&
      Number.isFinite(lastHeartbeatMs) &&
      lastHeartbeatMs > 0 &&
      nowMs - lastHeartbeatMs < minHeartbeatIntervalMs &&
      Number.isFinite(leaseExpiryMs) &&
      leaseExpiryMs - nowMs > minExpiryLeadMs
    ) {
      return true;
    }

    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(nowMs + WORKFLOW_MUTATION_LEASE_MS).toISOString();
    this.execRun(
      `UPDATE workflow_mutation_leases
         SET active_intent_id = ?,
             active_mutation_kind = ?,
             last_heartbeat_at = ?,
             lease_expires_at = ?
       WHERE workflow_id = ? AND owner_id = ?`,
      [
        options?.activeIntentId ?? null,
        options?.activeMutationKind ?? null,
        now,
        leaseExpiresAt,
        workflowId,
        ownerId,
      ],
    );
    return true;
  }

  releaseWorkflowMutationLease(workflowId: string, ownerId: string): void {
    this.execRun(
      'DELETE FROM workflow_mutation_leases WHERE workflow_id = ? AND owner_id = ?',
      [workflowId, ownerId],
    );
  }

  claimExecutionResourceLease(options: {
    resourceKey: string;
    resourceType: string;
    holderId: string;
    taskId?: string;
    poolId?: string;
    poolMemberId?: string;
    metadata?: unknown;
    leaseMs?: number;
  }): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + (options.leaseMs ?? EXECUTION_RESOURCE_LEASE_MS)).toISOString();
    return this.runTransaction(() => {
      this.execRun(
        'DELETE FROM execution_resource_leases WHERE resource_key = ? AND lease_expires_at <= ?',
        [options.resourceKey, nowIso],
      );
      const active = this.queryOne(
        `SELECT holder_id FROM execution_resource_leases
         WHERE resource_key = ?
           AND holder_id != ?
           AND lease_expires_at > ?
         LIMIT 1`,
        [options.resourceKey, options.holderId, nowIso],
      );
      if (active) return false;

      this.execRun(
        `INSERT OR REPLACE INTO execution_resource_leases (
          resource_key, resource_type, holder_id, task_id, pool_id, pool_member_id,
          acquired_at, last_heartbeat_at, lease_expires_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          options.resourceKey,
          options.resourceType,
          options.holderId,
          options.taskId ?? null,
          options.poolId ?? null,
          options.poolMemberId ?? null,
          nowIso,
          nowIso,
          leaseExpiresAt,
          options.metadata === undefined ? null : JSON.stringify(options.metadata),
        ],
      );
      return true;
    });
  }

  renewExecutionResourceLease(
    resourceKey: string,
    holderId: string,
    leaseMs = EXECUTION_RESOURCE_LEASE_MS,
  ): boolean {
    const now = new Date();
    this.execRun(
      `UPDATE execution_resource_leases
         SET last_heartbeat_at = ?,
             lease_expires_at = ?
       WHERE resource_key = ?
         AND holder_id = ?`,
      [
        now.toISOString(),
        new Date(now.getTime() + leaseMs).toISOString(),
        resourceKey,
        holderId,
      ],
    );
    const changed = (this.db.getRowsModified?.() ?? 0) as number;
    return changed > 0;
  }

  releaseExecutionResourceLease(resourceKey: string, holderId: string): void {
    this.execRun(
      'DELETE FROM execution_resource_leases WHERE resource_key = ? AND holder_id = ?',
      [resourceKey, holderId],
    );
  }

  listExecutionResourceLeases(): ExecutionResourceLease[] {
    return this.queryAll(
      'SELECT * FROM execution_resource_leases ORDER BY resource_key ASC, acquired_at ASC',
    ).map((row) => ({
      resourceKey: String(row.resource_key),
      resourceType: String(row.resource_type),
      holderId: String(row.holder_id),
      taskId: row.task_id ? String(row.task_id) : undefined,
      poolId: row.pool_id ? String(row.pool_id) : undefined,
      poolMemberId: row.pool_member_id ? String(row.pool_member_id) : undefined,
      acquiredAt: String(row.acquired_at),
      lastHeartbeatAt: String(row.last_heartbeat_at),
      leaseExpiresAt: String(row.lease_expires_at),
      metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : undefined,
    }));
  }

  /**
   * Return every execution-resource lease held on behalf of a specific
   * task. Used by the LaunchDispatcher when abandoning a stuck launch
   * to release any SSH-pool / worktree-pool leases the task acquired
   * during executor selection but never released (Issue 14).
   */
  listExecutionResourceLeasesByTask(taskId: string): ExecutionResourceLease[] {
    return this.queryAll(
      'SELECT * FROM execution_resource_leases WHERE task_id = ? ORDER BY acquired_at ASC',
      [taskId],
    ).map((row) => ({
      resourceKey: String(row.resource_key),
      resourceType: String(row.resource_type),
      holderId: String(row.holder_id),
      taskId: row.task_id ? String(row.task_id) : undefined,
      poolId: row.pool_id ? String(row.pool_id) : undefined,
      poolMemberId: row.pool_member_id ? String(row.pool_member_id) : undefined,
      acquiredAt: String(row.acquired_at),
      lastHeartbeatAt: String(row.last_heartbeat_at),
      leaseExpiresAt: String(row.lease_expires_at),
      metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : undefined,
    }));
  }

  enqueueLaunchDispatch(input: {
    taskId: string;
    attemptId: string;
    workflowId: string;
    priority?: TaskLaunchDispatchPriority;
    generation: number;
  }): TaskLaunchDispatch {
    const priority: TaskLaunchDispatchPriority = input.priority ?? 'normal';
    return this.runTransaction(() => {
      const existing = this.queryOne(
        `SELECT * FROM task_launch_dispatch
           WHERE attempt_id = ?
             AND state IN ('enqueued', 'leased', 'acknowledged')
           LIMIT 1`,
        [input.attemptId],
      );
      if (existing) {
        return this.rowToTaskLaunchDispatch(existing);
      }
      this.execRun(
        `INSERT INTO task_launch_dispatch (
          task_id, attempt_id, workflow_id, state, priority, generation
        ) VALUES (?, ?, ?, 'enqueued', ?, ?)`,
        [input.taskId, input.attemptId, input.workflowId, priority, input.generation],
      );
      const inserted = this.queryOne(
        `SELECT * FROM task_launch_dispatch
           WHERE attempt_id = ?
             AND state IN ('enqueued', 'leased', 'acknowledged')
           LIMIT 1`,
        [input.attemptId],
      );
      if (!inserted) {
        throw new Error('Failed to read back inserted task_launch_dispatch row');
      }
      return this.rowToTaskLaunchDispatch(inserted);
    });
  }

  loadLaunchDispatchById(id: number): TaskLaunchDispatch | undefined {
    const row = this.queryOne(
      'SELECT * FROM task_launch_dispatch WHERE id = ?',
      [id],
    );
    return row ? this.rowToTaskLaunchDispatch(row) : undefined;
  }

  loadLaunchDispatchByAttempt(attemptId: string): TaskLaunchDispatch | undefined {
    const row = this.queryOne(
      `SELECT * FROM task_launch_dispatch
         WHERE attempt_id = ?
           AND state IN ('enqueued', 'leased', 'acknowledged')
         ORDER BY id DESC
         LIMIT 1`,
      [attemptId],
    );
    return row ? this.rowToTaskLaunchDispatch(row) : undefined;
  }

  listLaunchDispatchesByState(
    states: readonly TaskLaunchDispatchState[],
  ): TaskLaunchDispatch[] {
    if (states.length === 0) return [];
    const placeholders = states.map(() => '?').join(', ');
    const rows = this.queryAll(
      `SELECT * FROM task_launch_dispatch
         WHERE state IN (${placeholders})
         ORDER BY id ASC`,
      states as unknown as unknown[],
    );
    return rows.map((row) => this.rowToTaskLaunchDispatch(row));
  }

  /**
   * Atomic capacity-gated lease of the next enqueued dispatch row.
   *
   * Selects the oldest enqueued row (priority high < normal < low, then id
   * ascending) and transitions it to `leased` only if the current count of
   * `leased | acknowledged` rows is below `maxConcurrency`. Wrapped in an
   * IMMEDIATE transaction so concurrent dispatchers cannot double-lease.
   * Returns the freshly leased row or `undefined` when nothing is enqueued,
   * capacity is exhausted, or another dispatcher beat us to it.
   */
  claimLaunchDispatchAtomic(options: {
    ownerId: string;
    maxConcurrency: number;
    nowIso?: string;
  }): TaskLaunchDispatch | undefined {
    if (options.maxConcurrency <= 0) return undefined;
    const now = options.nowIso ?? new Date().toISOString();
    const fencedUntil = new Date(
      new Date(now).getTime() + DISPATCH_LEASE_MS,
    ).toISOString();
    return this.runTransaction(() => {
      const activeRow = this.queryOne(
        `SELECT COUNT(*) AS active FROM task_launch_dispatch
           WHERE state IN ('leased', 'acknowledged')`,
      );
      const active = Number(activeRow?.active ?? 0);
      if (active >= options.maxConcurrency) return undefined;
      const candidate = this.queryOne(
        `SELECT id FROM task_launch_dispatch
           WHERE state = 'enqueued'
           ORDER BY CASE priority
             WHEN 'high' THEN 0
             WHEN 'normal' THEN 1
             ELSE 2
           END, id
           LIMIT 1`,
      );
      if (!candidate || candidate.id == null) return undefined;
      const candidateId = Number(candidate.id);
      this.execRun(
        `UPDATE task_launch_dispatch
           SET state = 'leased',
               dispatch_owner = ?,
               leased_at = ?,
               fenced_until = ?,
               attempts_count = attempts_count + 1
         WHERE id = ?
           AND state = 'enqueued'`,
        [options.ownerId, now, fencedUntil, candidateId],
      );
      const updated = (this.db.getRowsModified?.() ?? 0) > 0;
      if (!updated) return undefined;
      const row = this.queryOne(
        'SELECT * FROM task_launch_dispatch WHERE id = ?',
        [candidateId],
      );
      return row ? this.rowToTaskLaunchDispatch(row) : undefined;
    });
  }

  markLaunchDispatchAcknowledged(
    id: number,
    runnerId: string,
    nowIso?: string,
  ): boolean {
    const now = nowIso ?? new Date().toISOString();
    const fencedUntil = new Date(
      new Date(now).getTime() + DISPATCH_LEASE_MS,
    ).toISOString();
    this.execRun(
      `UPDATE task_launch_dispatch
         SET state = 'acknowledged',
             acknowledged_at = ?,
             dispatch_owner = ?,
             fenced_until = ?
       WHERE id = ?
         AND state = 'leased'`,
      [now, runnerId, fencedUntil, id],
    );
    return (this.db.getRowsModified?.() ?? 0) > 0;
  }

  markLaunchDispatchCompleted(id: number, nowIso?: string): boolean {
    const now = nowIso ?? new Date().toISOString();
    this.execRun(
      `UPDATE task_launch_dispatch
         SET state = 'completed',
             completed_at = ?
       WHERE id = ?
         AND state NOT IN ('completed', 'abandoned')`,
      [now, id],
    );
    return (this.db.getRowsModified?.() ?? 0) > 0;
  }

  markLaunchDispatchFailed(
    id: number,
    errorMessage: string,
    _nowIso?: string,
  ): boolean {
    this.execRun(
      `UPDATE task_launch_dispatch
         SET state = 'enqueued',
             last_error = ?,
             dispatch_owner = NULL,
             fenced_until = NULL
       WHERE id = ?
         AND state NOT IN ('completed', 'abandoned')`,
      [errorMessage, id],
    );
    return (this.db.getRowsModified?.() ?? 0) > 0;
  }

  /**
   * Return the dispatch rows in `acknowledged` whose fence has expired AND
   * whose `attempts_count` has reached `maxAttempts`. These are the rows
   * that the dispatcher should abandon and report to the orchestrator —
   * they have already burned through their retry budget without the
   * TaskRunner finishing the launch.
   */
  listAbandonableAcknowledgedLeases(options: {
    nowIso?: string;
    maxAttempts: number;
  }): TaskLaunchDispatch[] {
    const now = options.nowIso ?? new Date().toISOString();
    const rows = this.queryAll(
      `SELECT * FROM task_launch_dispatch
         WHERE state = 'acknowledged'
           AND fenced_until IS NOT NULL
           AND fenced_until < ?
           AND attempts_count >= ?
         ORDER BY id ASC`,
      [now, options.maxAttempts],
    );
    return rows.map((row) => this.rowToTaskLaunchDispatch(row));
  }

  /**
   * Terminal abandon: row leaves the live set. Returns false when the row
   * is already terminal so callers can treat a race as a no-op.
   */
  markLaunchDispatchAbandoned(
    id: number,
    errorMessage: string,
    nowIso?: string,
  ): boolean {
    const now = nowIso ?? new Date().toISOString();
    this.execRun(
      `UPDATE task_launch_dispatch
         SET state = 'abandoned',
             completed_at = ?,
             last_error = ?,
             dispatch_owner = NULL,
             fenced_until = NULL
       WHERE id = ?
         AND state NOT IN ('completed', 'abandoned')`,
      [now, errorMessage, id],
    );
    return (this.db.getRowsModified?.() ?? 0) > 0;
  }

  reapExpiredLaunchDispatchLeases(nowIso?: string): TaskLaunchDispatch[] {
    const now = nowIso ?? new Date().toISOString();
    return this.runTransaction(() => {
      const expired = this.queryAll(
        `SELECT * FROM task_launch_dispatch
           WHERE state = 'leased'
             AND fenced_until IS NOT NULL
             AND fenced_until < ?`,
        [now],
      );
      if (expired.length === 0) return [];
      this.execRun(
        `UPDATE task_launch_dispatch
           SET state = 'enqueued',
               dispatch_owner = NULL,
               fenced_until = NULL
         WHERE state = 'leased'
           AND fenced_until IS NOT NULL
           AND fenced_until < ?`,
        [now],
      );
      return expired.map((row) => {
        const reset = { ...row, state: 'enqueued', dispatch_owner: null, fenced_until: null };
        return this.rowToTaskLaunchDispatch(reset);
      });
    });
  }

  private rowToTaskLaunchDispatch(row: Record<string, unknown>): TaskLaunchDispatch {
    return rowToSQLiteTaskLaunchDispatch(row);
  }

  listWorkflowMutationLeases(): WorkflowMutationLease[] {
    return this.queryAll(
      'SELECT * FROM workflow_mutation_leases ORDER BY workflow_id ASC',
    ).map((row) => this.rowToWorkflowMutationLease(row));
  }

  requeueExpiredWorkflowMutationLeases(now: Date = new Date()): number {
    const expiredRows = this.queryAll(
      'SELECT workflow_id FROM workflow_mutation_leases WHERE lease_expires_at < ?',
      [now.toISOString()],
    );
    const workflowIds = expiredRows.map((row) => String(row.workflow_id));
    for (const workflowId of workflowIds) {
      this.requeueWorkflowMutationLease(workflowId);
    }
    return workflowIds.length;
  }

  completeWorkflowMutationIntent(id: number): void {
    this.execRun(
      `UPDATE workflow_mutation_intents
         SET status = 'completed', completed_at = ?, error = NULL
       WHERE id = ?`,
      [new Date().toISOString(), id],
    );
  }

  failWorkflowMutationIntent(id: number, error: string): void {
    this.execRun(
      `UPDATE workflow_mutation_intents
         SET status = 'failed', completed_at = ?, error = ?
       WHERE id = ?`,
      [new Date().toISOString(), error, id],
    );
  }

  private rowToWorkflowMutationIntent(row: Record<string, unknown>): WorkflowMutationIntent {
    return rowToSQLiteWorkflowMutationIntent(row);
  }

  private rowToWorkflowMutationLease(row: Record<string, unknown>): WorkflowMutationLease {
    return rowToSQLiteWorkflowMutationLease(row);
  }

  private requeueWorkflowMutationLease(workflowId: string): void {
    this.execRun(
      `UPDATE workflow_mutation_intents
         SET status = 'queued', owner_id = NULL, started_at = NULL, completed_at = NULL, error = NULL
       WHERE workflow_id = ? AND status = 'running'`,
      [workflowId],
    );
    this.execRun(
      'DELETE FROM workflow_mutation_leases WHERE workflow_id = ?',
      [workflowId],
    );
  }
}
