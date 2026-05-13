/**
 * Configuration loader for Invoker.
 *
 * Reads from ~/.invoker/config.json (user-level config).
 * Override with INVOKER_REPO_CONFIG_PATH env var (for tests).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export type ExecutionPoolMemberConfig =
  | { type: 'ssh'; id: string; maxConcurrentTasks?: number }
  | { type: 'worktree'; id: string; maxConcurrentTasks?: number };

export interface ExecutionPoolConfig {
  members: ExecutionPoolMemberConfig[];
  selectionStrategy?: 'roundRobin' | 'leastLoaded';
  maxConcurrentTasksPerMember?: number;
}

export interface InvokerConfig {
  defaultBranch?: string;
  /**
   * When true, skip relaunching orphaned running tasks on GUI startup.
   * Useful when you want to inspect state before tasks resume automatically.
   * Default: false
   */
  disableAutoRunOnStartup?: boolean;
  /**
   * Allow plans with task IDs that overlap existing workflows.
   * When false (default), submitting a plan whose task IDs already exist
   * in an active workflow will be rejected with an error message.
   * Set to true to permit intentional graph mutation.
   */
  allowGraphMutation?: boolean;
  /**
   * Global retry budget for auto-fix attempts per failed task.
   * Default: 0 (disabled).
   */
  autoFixRetries?: number;
  /**
   * When true, successful AI-applied fixes are automatically approved.
   * This skips the manual "Approve Fix" step for fix-with-agent and
   * resolve-conflict flows.
   *
   * Default: false.
   */
  autoApproveAIFixes?: boolean;
  /**
   * Preferred execution agent for automatic fix retries.
   * When unset, auto-fix falls back to the task's executionAgent,
   * then to the built-in default agent.
   */
  autoFixAgent?: string;
  /** Cursor CLI subprocess timeout for plan conversations in seconds. Default: 7200 (2 hours). */
  planningTimeoutSeconds?: number;
  /** Interval for heartbeat messages posted to Slack during planning in seconds. Default: 120 (2 minutes). Set to 0 to disable. */
  planningHeartbeatIntervalSeconds?: number;
  /** Maximum number of tasks that can run concurrently. Default: 6. */
  maxConcurrency?: number;
  /** Browser executable for opening external URLs (e.g. "firefox"). Default: Chrome. */
  browser?: string;
  /** Cloudflare R2 (or S3-compatible) storage for PR images. Env var fallback: R2_*. */
  imageStorage?: {
    provider: 'r2';
    accountId: string;
    bucketName: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** e.g. "https://bucket.r2.dev" or custom domain */
    publicUrlBase: string;
  };
  /** Docker execution environment configuration. */
  docker?: {
    /** Docker image to use for container tasks. Default: 'invoker/agent-base:latest'. */
    imageName?: string;
    /**
     * Path to a `KEY=value` secrets file (chmod 600/400) that is loaded and
     * forwarded to the container as additional environment variables. The
     * file's keys are appended to the container's `Env` array verbatim.
     *
     * Default fallback: `~/.config/invoker/secrets.env` (used only when the
     * file actually exists). When unset and the default is missing, no extra
     * secrets are forwarded.
     */
    secretsFile?: string;
  };
  /** Named remote SSH targets for running tasks on remote machines via SSH key auth. */
  remoteTargets?: Record<string, {
    host: string;
    user: string;
    /** Path to SSH identity file (private key). */
    sshKeyPath: string;
    /** SSH port. Default: 22. */
    port?: number;
    /**
     * When true, use managed workspace mode: clone/fetch repo, create/reset worktrees,
     * and provision per-task workspaces. When false (default), BYO mode: user provides
     * pre-cloned repo path and handles all git/setup operations.
     */
    managedWorkspaces?: boolean;
    /**
     * Remote invoker home directory (e.g., ~/.invoker). Only used in managed mode.
     * Default: ~/.invoker
     */
    remoteInvokerHome?: string;
    /**
     * Optional provision command to run in the worktree after creation (e.g., pnpm install).
     * Only used in managed mode. Default: pnpm install --frozen-lockfile
     */
    provisionCommand?: string;
    /**
     * Remote workload heartbeat interval (seconds) emitted by the SSH payload wrapper.
     * Used for SSH executing-stall liveness checks. Default: 30.
     */
    remoteHeartbeatIntervalSeconds?: number;
    /** Maximum tasks that may run concurrently on this SSH machine. Default: 1. */
    maxConcurrentTasks?: number;
  }>;
  /**
   * Named execution pools. Pools can mix SSH and local worktree members behind
   * a single task-facing poolId.
   */
  executionPools?: Record<string, ExecutionPoolConfig>;
}

function readJsonSafe(path: string): InvokerConfig {
  if (!existsSync(path)) {
    return {};
  }

  const raw = readFileSync(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Invoker config JSON at ${path}: ${message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid Invoker config at ${path}: expected a JSON object`);
  }

  const config = parsed as InvokerConfig;
  validateExecutionPools(config, path);
  return config;
}

function validateExecutionPools(config: InvokerConfig, path: string): void {
  const pools = config.executionPools;
  if (pools === undefined) return;
  if (typeof pools !== 'object' || pools === null || Array.isArray(pools)) {
    throw new Error(`Invalid Invoker config at ${path}: "executionPools" must be an object`);
  }
  const remoteTargetIds = new Set(Object.keys(config.remoteTargets ?? {}));
  const seenMembers = new Map<string, string>();
  for (const [poolId, pool] of Object.entries(pools)) {
    if (typeof pool !== 'object' || pool === null || Array.isArray(pool)) {
      throw new Error(`Invalid Invoker config at ${path}: executionPools.${poolId} must be an object`);
    }
    const members = pool.members;
    if (!Array.isArray(members)) {
      throw new Error(`Invalid Invoker config at ${path}: executionPools.${poolId}.members must be an array`);
    }
    if (members.length === 0) {
      throw new Error(`Invalid Invoker config at ${path}: executionPools.${poolId}.members must not be empty`);
    }
    if (
      pool.selectionStrategy !== undefined &&
      pool.selectionStrategy !== 'roundRobin' &&
      pool.selectionStrategy !== 'leastLoaded'
    ) {
      throw new Error(
        `Invalid Invoker config at ${path}: executionPools.${poolId}.selectionStrategy ` +
        'must be "roundRobin" or "leastLoaded"',
      );
    }
    for (const member of members) {
      if (
        typeof member !== 'object' ||
        member === null ||
        (member.type !== 'ssh' && member.type !== 'worktree') ||
        typeof member.id !== 'string' ||
        member.id.trim() === ''
      ) {
        throw new Error(
          `Invalid Invoker config at ${path}: executionPools.${poolId}.members entries ` +
          'must include { type: "ssh" | "worktree", id: string }',
        );
      }
      if (member.type === 'ssh' && !remoteTargetIds.has(member.id)) {
        throw new Error(
          `Invalid Invoker config at ${path}: executionPools.${poolId} SSH member "${member.id}" ` +
          'must be a key in remoteTargets',
        );
      }
      const memberKey = `${member.type}:${member.id}`;
      const owner = seenMembers.get(memberKey);
      if (owner && owner !== poolId) {
        throw new Error(
          `Invalid Invoker config at ${path}: execution pool member "${memberKey}" ` +
          `is shared by pools "${owner}" and "${poolId}"`,
        );
      }
      seenMembers.set(memberKey, poolId);
    }
  }
}

export function loadConfig(): InvokerConfig {
  if (process.env.INVOKER_REPO_CONFIG_PATH) {
    return readJsonSafe(process.env.INVOKER_REPO_CONFIG_PATH);
  }
  return readJsonSafe(join(homedir(), '.invoker', 'config.json'));
}

/**
 * Resolve the secrets file path for Docker tasks.
 *
 * Returns the explicit `docker.secretsFile` from config (with `~` expansion)
 * if set; otherwise returns `~/.config/invoker/secrets.env` if that file
 * exists; otherwise returns `undefined` (no secrets forwarded).
 */
export function resolveSecretsFilePath(config: InvokerConfig): string | undefined {
  const explicit = config.docker?.secretsFile;
  if (explicit) {
    if (explicit === '~') return homedir();
    if (explicit.startsWith('~/')) return resolve(homedir(), explicit.slice(2));
    return explicit;
  }
  const fallback = join(homedir(), '.config', 'invoker', 'secrets.env');
  if (existsSync(fallback)) return fallback;
  return undefined;
}
