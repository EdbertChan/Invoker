/**
 * Runtime service composition factory.
 *
 * Constructs the core services required by both GUI and headless modes:
 * orchestrator, persistence, transport, execution engine.
 *
 * Lifecycle concerns (DB writer locks, shell env, hourly backups) remain
 * with the caller — this module only handles wiring.
 */

import { Orchestrator, CommandService } from '@invoker/workflow-core';
import type { TaskState, ExecutorRoutingRule } from '@invoker/workflow-core';
import { SQLiteAdapter, SqliteTaskRepository } from '@invoker/data-store';
import { IpcBus } from '@invoker/transport';
import type { MessageBus } from '@invoker/transport';
import {
  ExecutorRegistry,
  WorktreeExecutor,
  type AgentRegistry,
} from '@invoker/execution-engine';
import type { Logger } from '@invoker/contracts';

// ── Public Interfaces ────────────────────────────────────────

/**
 * Options required to compose the runtime service layer.
 */
export interface ComposeOptions {
  /** Absolute path to the SQLite database file. */
  dbPath: string;

  /** Open the database in read-only mode (no writes, no owner capability). */
  readOnly?: boolean;

  /** Absolute path for worktree storage. */
  worktreeBaseDir: string;

  /** Absolute path for repo cache (shared clones). */
  repoCacheDir: string;

  /** Maximum number of concurrent worktrees. */
  maxWorktrees: number;

  /** Maximum task concurrency for the orchestrator scheduler. */
  maxConcurrency: number;

  /** Default auto-fix retry budget. */
  defaultAutoFixRetries?: number;

  /** Executor routing rules from user config. */
  executorRoutingRules?: ExecutorRoutingRule[];

  /**
   * When true, tasks remain pending until the executor confirms launch.
   * Matches existing behavior: main.ts always passes `true`.
   */
  deferRunningUntilLaunch?: boolean;

  /**
   * Fire-and-forget task dispatcher callback.
   * Called by the orchestrator when tasks enter the running state.
   */
  taskDispatcher?: (tasks: TaskState[]) => void;

  /** Optional agent registry for executor construction. */
  agentRegistry?: AgentRegistry;

  /** Optional logger for the orchestrator. */
  logger?: Logger;

  /**
   * IPC bus options. When provided as an existing MessageBus instance,
   * that bus is reused. Otherwise a fresh IpcBus is created.
   */
  messageBus?: MessageBus;

  /**
   * Controls startup sync behavior after construction.
   * - 'all': calls orchestrator.syncAllFromDb() immediately (default)
   * - 'none': defers sync to the caller
   */
  startupSyncMode?: 'all' | 'none';
}

/**
 * The composed runtime services — the core dependency set for all modes.
 */
export interface RuntimeServices {
  messageBus: MessageBus;
  persistence: SQLiteAdapter;
  executorRegistry: ExecutorRegistry;
  orchestrator: Orchestrator;
  commandService: CommandService;
}

// ── Bridge Support ───────────────────────────────────────────

/**
 * Options for creating an API bridge to the runtime services.
 *
 * The bridge allows external API servers (e.g. svc-api) to optionally attach
 * to the shared runtime composition. The bridge is dormant by default and must
 * be explicitly activated by the consumer.
 */
export interface RuntimeBridgeConfig {
  /**
   * When true, the bridge is active and the API layer may query runtime state.
   * Defaults to false (dormant).
   */
  enabled: boolean;

  // TODO: Add tenant isolation config when multi-tenant support is implemented
  // TODO: Add auth token validation config for bridge-level access control
}

/**
 * Create a bridge-compatible view of RuntimeServices.
 *
 * Returns the services reference unchanged — the dormant/active gating is
 * handled by the consumer (svc-api). This function serves as a documented
 * integration point and future location for bridge-specific transforms
 * (e.g. read-only wrappers, tenant-scoped views).
 */
export function createApiBridge(
  services: RuntimeServices,
  _config: RuntimeBridgeConfig,
): RuntimeServices {
  // TODO: Wrap services in read-only proxy when tenant isolation is active
  // TODO: Apply request-scoped auth context to orchestrator queries
  return services;
}

// ── Factory ──────────────────────────────────────────────────

/**
 * Compose the runtime service layer.
 *
 * Startup order matches the existing `initServices()` in main.ts:
 * 1. MessageBus
 * 2. SQLiteAdapter (persistence)
 * 3. ExecutorRegistry (with worktree executor)
 * 4. Orchestrator (with task repository, config, dispatcher)
 * 5. CommandService
 * 6. Optional startup sync
 */
export async function composeRuntimeServices(options: ComposeOptions): Promise<RuntimeServices> {
  // 1. Message bus
  const messageBus: MessageBus = options.messageBus ?? new IpcBus();

  // 2. Persistence
  const readOnly = options.readOnly === true;
  const persistence = await SQLiteAdapter.create(options.dbPath, {
    readOnly,
    ownerCapability: !readOnly,
  });

  // 3. Executor registry
  const executorRegistry = new ExecutorRegistry();
  executorRegistry.register(
    'worktree',
    new WorktreeExecutor({
      worktreeBaseDir: options.worktreeBaseDir,
      cacheDir: options.repoCacheDir,
      maxWorktrees: options.maxWorktrees,
      agentRegistry: options.agentRegistry,
    }),
  );

  // 4. Orchestrator
  const taskRepository = new SqliteTaskRepository(persistence);
  const orchestrator = new Orchestrator({
    persistence,
    messageBus,
    taskRepository,
    maxConcurrency: options.maxConcurrency,
    defaultAutoFixRetries: options.defaultAutoFixRetries,
    executorRoutingRules: options.executorRoutingRules ?? [],
    deferRunningUntilLaunch: options.deferRunningUntilLaunch ?? true,
    taskDispatcher: options.taskDispatcher,
    logger: options.logger,
  });

  // 5. Command service
  const commandService = new CommandService(orchestrator);

  // 6. Startup sync
  const startupSyncMode = options.startupSyncMode ?? 'all';
  if (startupSyncMode === 'all') {
    orchestrator.syncAllFromDb();
  }

  return {
    messageBus,
    persistence,
    executorRegistry,
    orchestrator,
    commandService,
  };
}
