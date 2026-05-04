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
  tryPingHeadlessOwner,
} from './headless-delegation.js';
import {
  spawnDetachedStandaloneOwner,
  tryAcquireOwnerBootstrapLock,
} from './headless-owner-bootstrap.js';
import { loadConfig } from './config.js';

// ---------------------------------------------------------------------------
// Terminal colours
// ---------------------------------------------------------------------------

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// ---------------------------------------------------------------------------
// Electron helpers (used when the CLI must spawn a full Electron process)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

const DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS = 30_000;
const POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS = 90_000;
const POST_BOOTSTRAP_OWNER_READY_TIMEOUT_MS = 20_000;
const READ_ONLY_QUERY_OWNER_READY_TIMEOUT_MS = 20_000;
const READ_ONLY_QUERY_REQUEST_TIMEOUT_MS = 8_000;
const BOOTSTRAP_RETRY_ATTEMPTS = 3;
const DEFAULT_STANDALONE_OWNER_BOOTSTRAP_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Owner identification
// ---------------------------------------------------------------------------

type HeadlessOwnerInfo = { ownerId?: string; mode?: string };

function isStandaloneOwner(owner: HeadlessOwnerInfo | null | undefined): owner is HeadlessOwnerInfo & { mode: 'standalone' } {
  return owner?.mode === 'standalone';
}

function standaloneOwnerBootstrapTimeoutMs(): number {
  const raw = process.env.INVOKER_HEADLESS_OWNER_BOOTSTRAP_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_STANDALONE_OWNER_BOOTSTRAP_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class SharedMutationOwnerTimeoutError extends Error {
  constructor(message: string = 'Timed out waiting for a standalone shared mutation owner to become available') {
    super(message);
    this.name = 'SharedMutationOwnerTimeoutError';
  }
}

export function isSharedMutationOwnerTimeoutError(error: unknown): error is SharedMutationOwnerTimeoutError {
  return error instanceof SharedMutationOwnerTimeoutError;
}

// ---------------------------------------------------------------------------
// Dispatch: send a mutation command to a specific owner via IPC
//
// This is the low-level send — it picks the right IPC channel (run, resume,
// or generic exec) and applies the correct timeout.  It does NOT decide
// *which* owner to talk to; that is the caller's job.
// ---------------------------------------------------------------------------

async function dispatchToOwner(
  args: string[],
  bus: MessageBus,
  waitForApproval?: boolean,
  noTrack?: boolean,
  noTrackTimeoutMs: number = DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS,
): Promise<boolean> {
  const command = args[0];
  const timeoutMs = noTrack
    ? noTrackTimeoutMs
    : command === 'run' || command === 'resume'
      ? 5_000
      : await resolveDelegationTimeoutMs(args);
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

// ---------------------------------------------------------------------------
// Read-only query delegation (query ui-perf, query queue)
//
// These queries always require a live owner (standalone or GUI) and never
// fall back to a local Electron process.  The caller polls until the owner
// is reachable and the query service is ready.
// ---------------------------------------------------------------------------

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

  // Wait for any owner (standalone or GUI) to respond to a ping.
  const deadline = Date.now() + READ_ONLY_QUERY_OWNER_READY_TIMEOUT_MS;
  let messageBus = bus;
  let owner: HeadlessOwnerInfo | null = null;
  while (Date.now() < deadline) {
    owner = await tryPingHeadlessOwner(messageBus, 2_000);
    if (owner) break;
    if (refreshMessageBus) {
      messageBus = await refreshMessageBus();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!owner) {
    throw new Error(isUiPerf
      ? 'query ui-perf requires a running shared owner process'
      : 'query queue requires a running shared owner process');
  }

  // Owner is alive — poll until the query service is ready.
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

  // Format and print the response.
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

// ---------------------------------------------------------------------------
// Poll for a standalone owner after bootstrap and dispatch.
//
// After ensureStandaloneOwner returns, the new process may still be
// initialising.  This polls until a standalone owner responds and then
// dispatches the mutation.
// ---------------------------------------------------------------------------

async function pollAndDispatchAfterBootstrap(
  args: string[],
  bus: MessageBus,
  refreshMessageBus: (() => Promise<MessageBus>) | undefined,
  waitForApproval?: boolean,
  noTrack?: boolean,
): Promise<boolean> {
  const deadline = Date.now() + POST_BOOTSTRAP_OWNER_READY_TIMEOUT_MS;
  let messageBus = bus;
  while (Date.now() < deadline) {
    const owner = await tryPingHeadlessOwner(messageBus, 1_000);
    if (isStandaloneOwner(owner) && await dispatchToOwner(
      args,
      messageBus,
      waitForApproval,
      noTrack,
      noTrack ? POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS : DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS,
    )) {
      return true;
    }
    if (refreshMessageBus) {
      messageBus = await refreshMessageBus();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public: dependency-injection interface
// ---------------------------------------------------------------------------

export interface HeadlessClientDeps {
  messageBus: MessageBus;
  ensureStandaloneOwner: (bus?: MessageBus) => Promise<void>;
  refreshMessageBus?: () => Promise<MessageBus>;
  runElectronHeadless: (args: string[]) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Owner bootstrap (real implementation wired in runHeadlessClient)
// ---------------------------------------------------------------------------

async function ensureStandaloneOwnerViaBootstrap(bus: MessageBus): Promise<void> {
  const invokerHomeRoot = resolveInvokerHomeRoot();
  const bootstrapLock = tryAcquireOwnerBootstrapLock(invokerHomeRoot);
  try {
    if (bootstrapLock) {
      spawnDetachedStandaloneOwner(resolve(__dirname, '..', '..', '..'));
    }
    const deadline = Date.now() + standaloneOwnerBootstrapTimeoutMs();
    while (Date.now() < deadline) {
      const owner = await tryPingHeadlessOwner(bus, 500);
      if (isStandaloneOwner(owner)) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    throw new SharedMutationOwnerTimeoutError();
  } finally {
    bootstrapLock?.release();
  }
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main routing — runHeadlessClientCommand
//
// Routing follows the shared transport policy with three paths:
//
//   Path 1 — Read-only query (query ui-perf, query queue):
//     Delegate to any live owner.  Never fall back to Electron.
//
//   Path 2 — Non-mutating command, standalone mode, or owner-serve:
//     Run directly via Electron.
//
//   Path 3 — Mutating command:
//     (a) Try the live owner (standalone or GUI).
//     (b) If no owner, bootstrap a standalone owner and retry.
//     (c) If bootstrap times out, refresh the bus and retry up to
//         BOOTSTRAP_RETRY_ATTEMPTS times.
// ---------------------------------------------------------------------------

export async function runHeadlessClientCommand(
  argv: string[],
  deps: HeadlessClientDeps,
): Promise<number> {
  // Validate config early so malformed JSON fails before any delegation.
  loadConfig();

  let messageBus = deps.messageBus;
  const { args, waitForApproval, noTrack } = parseArgs(argv);
  const standaloneMode = process.env.INVOKER_HEADLESS_STANDALONE === '1';
  const internalOwnerServe = args[0] === 'owner-serve';
  const resolvedExitCode = (): number => {
    const exitCode = process.exitCode;
    return typeof exitCode === 'number' ? exitCode : 0;
  };

  // --- Path 1: Read-only queries delegate to any live owner. ---
  if (!standaloneMode && !internalOwnerServe && await delegateReadOnlyQuery(args, messageBus, deps.refreshMessageBus)) {
    return resolvedExitCode();
  }

  // --- Path 2: Non-mutating, standalone, or owner-serve → Electron. ---
  if (!isHeadlessMutatingCommand(args) || standaloneMode || internalOwnerServe) {
    return deps.runElectronHeadless(argv);
  }

  // --- Path 3: Mutating command — delegate to an owner. ---

  // Step 1: Try the live owner (standalone or GUI).
  // A GUI owner can accept mutations directly; no refresh or bootstrap needed.
  const owner = await tryPingHeadlessOwner(messageBus, 3_000);
  if (owner) {
    if (await dispatchToOwner(args, messageBus, waitForApproval, noTrack)) {
      return resolvedExitCode();
    }
    // The owner responded to ping but rejected the dispatch.
    // Refresh the bus and try once more before falling through to bootstrap.
    if (deps.refreshMessageBus) {
      messageBus = await deps.refreshMessageBus();
      const refreshedOwner = await tryPingHeadlessOwner(messageBus, 1_000);
      if (refreshedOwner && await dispatchToOwner(args, messageBus, waitForApproval, noTrack)) {
        return resolvedExitCode();
      }
    }
  }

  // Step 2: No usable owner — bootstrap a standalone owner and retry.
  if (deps.refreshMessageBus) {
    messageBus = await deps.refreshMessageBus();
  }
  for (let attempt = 0; attempt < BOOTSTRAP_RETRY_ATTEMPTS; attempt += 1) {
    // Bootstrap (or retry after a stale-bus timeout).
    try {
      await deps.ensureStandaloneOwner(messageBus);
    } catch (err) {
      if (!isSharedMutationOwnerTimeoutError(err)) throw err;
      if (!deps.refreshMessageBus) throw err;
      messageBus = await deps.refreshMessageBus();
      await deps.ensureStandaloneOwner(messageBus);
    }

    // Refresh after bootstrap so we see the new owner's IPC socket.
    if (deps.refreshMessageBus) {
      messageBus = await deps.refreshMessageBus();
    }

    // Poll until the new standalone owner is ready and dispatch.
    if (await pollAndDispatchAfterBootstrap(args, messageBus, deps.refreshMessageBus, waitForApproval, noTrack)) {
      return resolvedExitCode();
    }

    // Owner was lost again — refresh and retry the bootstrap loop.
    if (!deps.refreshMessageBus) break;
    messageBus = await deps.refreshMessageBus();
  }

  process.stderr.write(
    `${RED}Error:${RESET} Mutation command "${args[0] ?? ''}" could not reach a standalone shared owner after bootstrap.\n`,
  );
  return 1;
}

// ---------------------------------------------------------------------------
// Real entry-point: wires IpcBus and bootstrap into the routing.
// ---------------------------------------------------------------------------

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
