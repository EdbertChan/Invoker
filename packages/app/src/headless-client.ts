/**
 * Headless Client — CLI entry point for headless command execution.
 *
 * Routing policy (matches the shared transport in headless-transport.ts):
 *
 *   1. Read-only queries (queue, ui-perf) → delegate to any reachable owner.
 *   2. Standalone mode or non-mutating commands → run locally via Electron.
 *   3. Mutating commands in shared-owner mode → discover or bootstrap an owner,
 *      then delegate via IPC.
 *
 * GUI-owner delegation: if a GUI (non-standalone) owner is already running,
 * mutating commands delegate to it directly without bootstrapping a new one.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { IpcBus } from '@invoker/transport';
import type { MessageBus } from '@invoker/transport';

import { resolveInvokerHomeRoot } from './delete-all-snapshot.js';
import { isHeadlessMutatingCommand } from './headless-command-classification.js';
import {
  resolveDelegationTimeoutMs,
  tryDelegateExec,
  tryDelegateQuery,
  tryDelegateQueryUiPerf,
  tryDelegateResume,
  tryDelegateRun,
} from './headless-delegation.js';
import {
  spawnDetachedStandaloneOwner,
  tryAcquireOwnerBootstrapLock,
} from './headless-owner-bootstrap.js';
import { loadConfig } from './config.js';
import {
  discoverOwner,
  isOwnerReachable,
  isStandaloneCapable,
} from './owner-endpoint.js';
import { createOwnerResolver } from './owner-resolver.js';

// ── Constants ────────────────────────────────────────────────

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

/** Timeout for no-track delegation to an already-running owner. */
const NO_TRACK_DELEGATION_TIMEOUT_MS = 30_000;
/** Longer timeout for no-track delegation after a fresh bootstrap. */
const POST_BOOTSTRAP_NO_TRACK_TIMEOUT_MS = 90_000;
/** How long to poll for an owner after bootstrap before giving up. */
const POST_BOOTSTRAP_READY_TIMEOUT_MS = 20_000;
/** How long to wait for an owner to appear for read-only queries. */
const READ_ONLY_QUERY_OWNER_TIMEOUT_MS = 20_000;
/** Per-request timeout when polling a query endpoint. */
const READ_ONLY_QUERY_REQUEST_TIMEOUT_MS = 8_000;
/** Max attempts to bootstrap an owner before failing. */
const MAX_BOOTSTRAP_ATTEMPTS = 3;
/** Default timeout for the bootstrap spawn+ready cycle. */
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 60_000;

// ── Logging ──────────────────────────────────────────────────

function log(message: string): void {
  process.stderr.write(`[headless-client] ${message}\n`);
}

// ── Exported error type ──────────────────────────────────────

export class SharedMutationOwnerTimeoutError extends Error {
  constructor(message: string = 'Timed out waiting for a standalone shared mutation owner to become available') {
    super(message);
    this.name = 'SharedMutationOwnerTimeoutError';
  }
}

export function isSharedMutationOwnerTimeoutError(error: unknown): error is SharedMutationOwnerTimeoutError {
  return error instanceof SharedMutationOwnerTimeoutError;
}

// ── Dependency contract ──────────────────────────────────────

export interface HeadlessClientDeps {
  messageBus: MessageBus;
  ensureStandaloneOwner: (bus?: MessageBus) => Promise<void>;
  refreshMessageBus?: () => Promise<MessageBus>;
  runElectronHeadless: (args: string[]) => Promise<number>;
}

// ── Command dispatch (sends a command to an owner via IPC) ───

/**
 * Dispatch a single command to the owner over IPC.
 *
 * Routes to the correct IPC channel (headless.run, headless.resume,
 * or headless.exec) and applies the appropriate timeout.
 */
async function dispatchCommand(
  args: string[],
  bus: MessageBus,
  waitForApproval?: boolean,
  noTrack?: boolean,
  noTrackTimeoutMs: number = NO_TRACK_DELEGATION_TIMEOUT_MS,
): Promise<boolean> {
  const command = args[0];
  const timeoutMs = noTrack
    ? noTrackTimeoutMs
    : command === 'run' || command === 'resume'
      ? 5_000
      : await resolveDelegationTimeoutMs(args);
  log(
    `dispatchCommand command=${command ?? '<missing>'} timeoutMs=${timeoutMs} noTrack=${noTrack ? 'true' : 'false'} waitForApproval=${waitForApproval ? 'true' : 'false'}`,
  );
  if (command === 'run') {
    const planPath = args[1];
    if (!planPath) throw new Error('Missing plan file. Usage: --headless run <plan.yaml>');
    return tryDelegateRun(planPath, bus, waitForApproval, noTrack, timeoutMs);
  }
  if (command === 'resume') {
    const workflowId = args[1];
    if (!workflowId) throw new Error('Missing workflowId. Usage: --headless resume <id>');
    return tryDelegateResume(workflowId, bus, waitForApproval, noTrack, timeoutMs);
  }
  return tryDelegateExec(args, bus, waitForApproval, noTrack, timeoutMs);
}

// ── Read-only query delegation ───────────────────────────────

/**
 * Handle read-only queries (ui-perf, queue) that require a live owner
 * but do not mutate state. Returns true if the query was handled.
 */
async function delegateReadOnlyQuery(
  args: string[],
  bus: MessageBus,
  refreshMessageBus?: () => Promise<MessageBus>,
): Promise<boolean> {
  const isUiPerf = args[0] === 'query' && args[1] === 'ui-perf';
  const isQueue = (args[0] === 'query' && args[1] === 'queue') || args[0] === 'queue';
  if (!isUiPerf && !isQueue) {
    return false;
  }

  // Wait for any reachable owner (standalone or GUI)
  const resolver = createOwnerResolver(
    { messageBus: bus, refreshMessageBus, ensureStandaloneOwner: async () => {} },
    { discoveryTimeoutMs: 2_000 },
  );
  const ownerResult = await resolver.waitForAny(READ_ONLY_QUERY_OWNER_TIMEOUT_MS);
  if (!ownerResult.resolved) {
    throw new Error(isUiPerf
      ? 'query ui-perf requires a running shared owner process'
      : 'query queue requires a running shared owner process');
  }

  // Poll the query endpoint until it responds
  let messageBus = ownerResult.bus;
  const deadline = Date.now() + READ_ONLY_QUERY_OWNER_TIMEOUT_MS;
  let response: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    if (isUiPerf) {
      const reset = args.includes('--reset');
      response = await tryDelegateQueryUiPerf(messageBus, reset, READ_ONLY_QUERY_REQUEST_TIMEOUT_MS);
    } else {
      response = await tryDelegateQuery(messageBus, { kind: 'queue' }, READ_ONLY_QUERY_REQUEST_TIMEOUT_MS);
    }
    if (response) break;
    if (refreshMessageBus) {
      messageBus = await refreshMessageBus();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!response) {
    throw new Error(isUiPerf
      ? 'Live owner is present but did not serve ui-perf query'
      : 'Live owner is present but did not serve queue query');
  }

  // Format and emit the response
  if (isUiPerf) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return true;
  }
  const outputIndex = args.indexOf('--output');
  const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  const running = Array.isArray(response.running) ? response.running as Array<Record<string, unknown>> : [];
  const queued = Array.isArray(response.queued) ? response.queued as Array<Record<string, unknown>> : [];
  if (output === 'json') {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } else if (output === 'jsonl') {
    for (const task of running) {
      process.stdout.write(`${JSON.stringify({ ...task, state: 'running' })}\n`);
    }
    for (const task of queued) {
      process.stdout.write(`${JSON.stringify({ ...task, state: 'queued' })}\n`);
    }
  } else if (output === 'label') {
    const ids = [...running, ...queued].map((task) => String(task.taskId ?? '')).filter(Boolean);
    process.stdout.write(`${ids.join('\n')}\n`);
  } else {
    const runningCount = Number(response.runningCount ?? running.length);
    const maxConcurrency = Number(response.maxConcurrency ?? 0);
    process.stdout.write(`running=${runningCount}/${maxConcurrency} queued=${queued.length}\n`);
  }
  return true;
}

// ── Shared-owner mutation delegation ─────────────────────────

/**
 * Discover (or bootstrap) an owner and delegate a mutating command.
 *
 * Phases:
 *   1. Try any already-reachable owner (standalone preferred, GUI accepted).
 *   2. Refresh the bus and retry discovery.
 *   3. Bootstrap a standalone owner with a retry loop, then delegate.
 *
 * Returns the exit code on success, or null if delegation failed.
 */
async function delegateToSharedOwner(
  args: string[],
  deps: HeadlessClientDeps,
  waitForApproval?: boolean,
  noTrack?: boolean,
): Promise<number | null> {
  const startedAt = Date.now();
  const command = args[0] ?? '<missing>';
  log(`delegateToSharedOwner begin command=${command} noTrack=${noTrack ? 'true' : 'false'}`);

  let messageBus = deps.messageBus;
  const exitCode = (): number => (typeof process.exitCode === 'number' ? process.exitCode : 0);

  // ─── Phase 1: Immediate discovery ───────────────────────────
  // Try the current bus. A standalone owner is preferred, but a GUI
  // owner also accepts mutations (it just won't survive after the
  // GUI closes).
  const owner = await discoverOwner(messageBus, 3_000);
  log(`discover standaloneCapable=${isStandaloneCapable(owner)} reachable=${isOwnerReachable(owner)} id=${owner?.ownerId ?? '<none>'}`);

  if (isOwnerReachable(owner)) {
    if (await dispatchCommand(args, messageBus, waitForApproval, noTrack)) {
      log(`delegated to existing owner elapsedMs=${Date.now() - startedAt}`);
      return exitCode();
    }
  }

  // ─── Phase 2: Refresh bus and retry (stale connection recovery) ─
  // Only attempt if an owner was found but delegation failed, which
  // suggests a stale IPC connection rather than no owner at all.
  if (isOwnerReachable(owner) && deps.refreshMessageBus) {
    log('phase2: refreshing stale bus');
    messageBus = await deps.refreshMessageBus();
    const refreshedOwner = await discoverOwner(messageBus, 1_000);
    if (isOwnerReachable(refreshedOwner)) {
      if (await dispatchCommand(args, messageBus, waitForApproval, noTrack)) {
        log(`delegated after refresh elapsedMs=${Date.now() - startedAt}`);
        return exitCode();
      }
    }
  }

  // ─── Phase 3: Bootstrap a standalone owner ──────────────────
  // No owner accepted the command. Spawn one and poll until it
  // responds. Retry up to MAX_BOOTSTRAP_ATTEMPTS in case the
  // owner crashes during startup.
  if (deps.refreshMessageBus) {
    messageBus = await deps.refreshMessageBus();
  }
  for (let attempt = 0; attempt < MAX_BOOTSTRAP_ATTEMPTS; attempt += 1) {
    log(`bootstrap attempt=${attempt + 1}/${MAX_BOOTSTRAP_ATTEMPTS}`);

    // Spawn the owner (or wait for another client's spawn to finish)
    try {
      await deps.ensureStandaloneOwner(messageBus);
    } catch (err) {
      if (!isSharedMutationOwnerTimeoutError(err)) throw err;
      if (!deps.refreshMessageBus) throw err;
      log(`bootstrap timeout; refreshing bus and retrying attempt=${attempt + 1}`);
      messageBus = await deps.refreshMessageBus();
      await deps.ensureStandaloneOwner(messageBus);
    }

    // Refresh the bus after bootstrap (the IPC server may have restarted)
    if (deps.refreshMessageBus) {
      messageBus = await deps.refreshMessageBus();
    }

    // Poll for the bootstrapped owner and try to dispatch
    const deadline = Date.now() + POST_BOOTSTRAP_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const bootstrapped = await discoverOwner(messageBus, 1_000);
      if (isStandaloneCapable(bootstrapped)) {
        const timeoutMs = noTrack ? POST_BOOTSTRAP_NO_TRACK_TIMEOUT_MS : NO_TRACK_DELEGATION_TIMEOUT_MS;
        if (await dispatchCommand(args, messageBus, waitForApproval, noTrack, timeoutMs)) {
          log(`delegated after bootstrap attempt=${attempt + 1} elapsedMs=${Date.now() - startedAt}`);
          return exitCode();
        }
      }
      if (deps.refreshMessageBus) {
        messageBus = await deps.refreshMessageBus();
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // Owner didn't come up — refresh and try next attempt
    if (!deps.refreshMessageBus) break;
    messageBus = await deps.refreshMessageBus();
  }

  log(`delegation failed after elapsedMs=${Date.now() - startedAt}`);
  return null;
}

// ── Bootstrap implementation ─────────────────────────────────

function bootstrapTimeoutMs(): number {
  const raw = process.env.INVOKER_HEADLESS_OWNER_BOOTSTRAP_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_BOOTSTRAP_TIMEOUT_MS;
}

async function ensureStandaloneOwnerViaBootstrap(bus: MessageBus): Promise<void> {
  const invokerHomeRoot = resolveInvokerHomeRoot();
  const bootstrapLock = tryAcquireOwnerBootstrapLock(invokerHomeRoot);
  const startedAt = Date.now();
  log(`bootstrap begin lockAcquired=${bootstrapLock ? 'true' : 'false'} home=${invokerHomeRoot}`);
  try {
    if (bootstrapLock) {
      log('bootstrap spawning detached standalone owner');
      spawnDetachedStandaloneOwner(resolve(__dirname, '..', '..', '..'));
    }
    const deadline = Date.now() + bootstrapTimeoutMs();
    let attempts = 0;
    while (Date.now() < deadline) {
      attempts += 1;
      const owner = await discoverOwner(bus, 500);
      if (isStandaloneCapable(owner)) {
        log(`bootstrap owner ready attempts=${attempts} elapsedMs=${Date.now() - startedAt} ownerId=${owner.ownerId}`);
        return;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    log(`bootstrap timeout elapsedMs=${Date.now() - startedAt}`);
    throw new SharedMutationOwnerTimeoutError();
  } finally {
    bootstrapLock?.release();
    log(`bootstrap end elapsedMs=${Date.now() - startedAt}`);
  }
}

// ── Arg parsing ──────────────────────────────────────────────

function parseArgs(argv: string[]): { args: string[]; waitForApproval?: boolean; noTrack?: boolean } {
  const args: string[] = [];
  let waitForApproval = false;
  let noTrack = false;
  for (const arg of argv) {
    if (arg === '--wait-for-approval') {
      waitForApproval = true;
    } else if (arg === '--no-track' || arg === '--do-not-track') {
      noTrack = true;
    } else {
      args.push(arg);
    }
  }
  return { args, waitForApproval, noTrack };
}

// ── Main entry points ────────────────────────────────────────

/**
 * Route a headless CLI command. This is the testable entry point that
 * accepts injected deps.
 *
 * Routing order (matches the shared transport policy):
 *   1. Read-only queries → delegate to any live owner.
 *   2. Standalone mode / non-mutating / owner-serve → run locally.
 *   3. Mutating commands → delegate to a shared owner (discover or bootstrap).
 */
export async function runHeadlessClientCommand(
  argv: string[],
  deps: HeadlessClientDeps,
): Promise<number> {
  // Validate config early so malformed JSON fails fast
  loadConfig();

  const { args, waitForApproval, noTrack } = parseArgs(argv);
  const standaloneMode = process.env.INVOKER_HEADLESS_STANDALONE === '1';
  const internalOwnerServe = args[0] === 'owner-serve';

  // Route 1: Read-only queries delegate to any live owner
  if (!standaloneMode && !internalOwnerServe && await delegateReadOnlyQuery(args, deps.messageBus, deps.refreshMessageBus)) {
    const code = process.exitCode;
    return typeof code === 'number' ? code : 0;
  }

  // Route 2: Non-mutating commands, standalone mode, and owner-serve run locally
  if (!isHeadlessMutatingCommand(args) || standaloneMode || internalOwnerServe) {
    return deps.runElectronHeadless(argv);
  }

  // Route 3: Mutating commands in shared-owner mode
  const result = await delegateToSharedOwner(args, deps, waitForApproval, noTrack);
  if (result !== null) {
    return result;
  }

  process.stderr.write(
    `${RED}Error:${RESET} Mutation command "${args[0] ?? ''}" could not reach a standalone shared owner after bootstrap.\n`,
  );
  return 1;
}

// ── Production wiring ────────────────────────────────────────

function electronCommandArgs(args: string[]): string[] {
  const mainJs = resolve(__dirname, 'main.js');
  return [
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    mainJs,
    '--headless',
    ...args,
  ];
}

async function runElectronHeadless(args: string[]): Promise<number> {
  const electronBin = resolve(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const child = spawn(electronBin, electronCommandArgs(args), {
    cwd: resolve(__dirname, '..', '..', '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      LIBGL_ALWAYS_SOFTWARE: process.platform === 'linux' ? '1' : process.env.LIBGL_ALWAYS_SOFTWARE,
    },
  });
  return await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`headless electron exited with signal ${signal}`));
        return;
      }
      resolveExit(code ?? 0);
    });
  });
}

async function flushOutputStream(stream: NodeJS.WriteStream): Promise<void> {
  await new Promise<void>((resolve) => {
    stream.write('', () => resolve());
  });
}

export async function runHeadlessClient(argv: string[]): Promise<number> {
  let bus = new IpcBus(undefined, { allowServe: false });
  const refreshMessageBus = async (): Promise<MessageBus> => {
    bus.disconnect();
    bus = new IpcBus(undefined, { allowServe: false });
    await bus.ready();
    return bus;
  };
  try {
    await bus.ready();
    return await runHeadlessClientCommand(argv, {
      messageBus: bus,
      ensureStandaloneOwner: (currentBus) => ensureStandaloneOwnerViaBootstrap(currentBus ?? bus),
      refreshMessageBus,
      runElectronHeadless,
    });
  } finally {
    bus.disconnect();
  }
}

if (require.main === module) {
  runHeadlessClient(process.argv.slice(2))
    .then(async (code) => {
      await Promise.all([
        flushOutputStream(process.stdout),
        flushOutputStream(process.stderr),
      ]);
      process.exitCode = code;
    })
    .catch(async (err) => {
      process.stderr.write(`${RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}\n`);
      await Promise.all([
        flushOutputStream(process.stdout),
        flushOutputStream(process.stderr),
      ]);
      process.exitCode = 1;
    });
}
