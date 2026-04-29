import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { IpcBus } from '@invoker/transport';
import type { MessageBus } from '@invoker/transport';

// Re-export transport primitives for scripts/headless-ipc.js (plain Node wrapper).
export { IpcBus } from '@invoker/transport';
export { HeadlessTransport } from './headless-transport.js';
export type {
  HeadlessExecOptions,
  HeadlessExecResult,
  HeadlessBatchOptions,
  HeadlessTransportDeps,
} from './headless-transport.js';

import { resolveInvokerHomeRoot } from './delete-all-snapshot.js';
import { isHeadlessMutatingCommand } from './headless-command-classification.js';
import {
  dispatchToOwner,
  resolveDelegationTimeoutMs,
  tryDelegateQuery,
  tryDelegateQueryUiPerf,
  tryPingHeadlessOwner,
} from './headless-delegation.js';
import {
  spawnDetachedStandaloneOwner,
  tryAcquireOwnerBootstrapLock,
} from './headless-owner-bootstrap.js';
import { loadConfig } from './config.js';

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

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

const DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS = 30_000;
const POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS = 90_000;
const POST_BOOTSTRAP_OWNER_READY_TIMEOUT_MS = 20_000;
const READ_ONLY_QUERY_OWNER_READY_TIMEOUT_MS = 20_000;
const READ_ONLY_QUERY_REQUEST_TIMEOUT_MS = 8_000;
const POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS = 3;
const DEFAULT_STANDALONE_OWNER_BOOTSTRAP_TIMEOUT_MS = 60_000;
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

export class SharedMutationOwnerTimeoutError extends Error {
  constructor(message: string = 'Timed out waiting for a standalone shared mutation owner to become available') {
    super(message);
    this.name = 'SharedMutationOwnerTimeoutError';
  }
}

export function isSharedMutationOwnerTimeoutError(error: unknown): error is SharedMutationOwnerTimeoutError {
  return error instanceof SharedMutationOwnerTimeoutError;
}

/**
 * Resolve the IPC timeout for a mutation delegation request.
 *
 * --no-track commands use a longer timeout because the owner may be under
 * load and we only need to confirm acceptance (not track to completion).
 */
function resolveMutationTimeoutMs(
  args: string[],
  noTrack: boolean | undefined,
  noTrackTimeoutMs: number,
): number | Promise<number> {
  if (noTrack) return noTrackTimeoutMs;
  const command = args[0];
  if (command === 'run' || command === 'resume') return 5_000;
  return resolveDelegationTimeoutMs(args);
}

/**
 * Validate required arguments, resolve timeout, then dispatch to the
 * shared dispatchToOwner helper. Throws on missing required args (plan
 * path for `run`, workflow id for `resume`).
 */
async function delegateMutationToOwner(
  args: string[],
  bus: MessageBus,
  waitForApproval?: boolean,
  noTrack?: boolean,
  noTrackTimeoutMs: number = DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS,
): Promise<boolean> {
  const command = args[0];
  if (command === 'run' && !args[1]) {
    throw new Error('Missing plan file. Usage: --headless run <plan.yaml>');
  }
  if (command === 'resume' && !args[1]) {
    throw new Error('Missing workflowId. Usage: --headless resume <id>');
  }
  const timeoutMs = await resolveMutationTimeoutMs(args, noTrack, noTrackTimeoutMs);
  return dispatchToOwner(args, bus, { waitForApproval, noTrack, timeoutMs });
}

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

/**
 * Poll for a standalone owner to become reachable, then dispatch the
 * mutation. Used after bootstrap when the owner process may still be
 * starting up.
 */
async function pollOwnerAndDispatch(
  args: string[],
  deps: Pick<HeadlessClientDeps, 'refreshMessageBus'>,
  bus: MessageBus,
  waitForApproval?: boolean,
  noTrack?: boolean,
): Promise<boolean> {
  const deadline = Date.now() + POST_BOOTSTRAP_OWNER_READY_TIMEOUT_MS;
  let messageBus = bus;
  while (Date.now() < deadline) {
    const owner = await tryPingHeadlessOwner(messageBus, 1_000);
    if (isStandaloneOwner(owner) && await delegateMutationToOwner(
      args,
      messageBus,
      waitForApproval,
      noTrack,
      noTrack ? POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS : DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS,
    )) {
      return true;
    }
    if (deps.refreshMessageBus) {
      messageBus = await deps.refreshMessageBus();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export interface HeadlessClientDeps {
  messageBus: MessageBus;
  ensureStandaloneOwner: (bus?: MessageBus) => Promise<void>;
  refreshMessageBus?: () => Promise<MessageBus>;
  runElectronHeadless: (args: string[]) => Promise<number>;
}

export async function ensureStandaloneOwnerViaBootstrap(bus: MessageBus): Promise<void> {
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

/**
 * CLI routing entry point.
 *
 * Routing phases (in order):
 *   1. Config validation — fail fast on malformed config.
 *   2. Read-only query fast-path — ui-perf / queue bypass Electron.
 *   3. Non-mutating / standalone / owner-serve → Electron subprocess.
 *   4. Try any existing owner (GUI or standalone) via IPC.
 *   5. If no owner responded, bootstrap a standalone owner and dispatch.
 */
export async function runHeadlessClientCommand(
  argv: string[],
  deps: HeadlessClientDeps,
): Promise<number> {
  // Phase 1: Config validation — fail fast on malformed JSON before any
  // delegation so errors surface even for non-Electron paths.
  loadConfig();

  let messageBus = deps.messageBus;
  const { args, waitForApproval, noTrack } = parseArgs(argv);
  const standaloneMode = process.env.INVOKER_HEADLESS_STANDALONE === '1';
  const internalOwnerServe = args[0] === 'owner-serve';
  const resolvedExitCode = (): number => {
    const exitCode = process.exitCode;
    return typeof exitCode === 'number' ? exitCode : 0;
  };

  // Phase 2: Read-only query fast-path — query ui-perf and query queue
  // are delegated directly to any live owner (GUI or standalone) without
  // booting Electron.
  if (!standaloneMode && !internalOwnerServe && await delegateReadOnlyQuery(args, messageBus, deps.refreshMessageBus)) {
    return resolvedExitCode();
  }

  // Phase 3: Non-mutating commands, standalone mode, and the internal
  // owner-serve command all run inside the Electron subprocess.
  if (!isHeadlessMutatingCommand(args) || standaloneMode || internalOwnerServe) {
    return deps.runElectronHeadless(argv);
  }

  // --- From here on, the command is a mutation that should reach an
  //     owner (GUI or standalone) via IPC. ---

  // Phase 4: Try any existing owner — GUI owners can handle mutations
  // just like standalone owners (they register headless.run / .exec / .resume).
  const owner = await tryPingHeadlessOwner(messageBus, 3_000);
  if (owner) {
    if (await delegateMutationToOwner(args, messageBus, waitForApproval, noTrack)) {
      return resolvedExitCode();
    }
    // Delegation failed on this bus. If a standalone owner may be on a
    // different socket, refresh and retry.
    if (deps.refreshMessageBus) {
      messageBus = await deps.refreshMessageBus();
      if (await delegateMutationToOwner(args, messageBus, waitForApproval, noTrack)) {
        return resolvedExitCode();
      }
    }
  }

  // Phase 5: No owner responded — bootstrap a standalone owner process,
  // then poll until it responds and dispatch the mutation. Retries up to
  // POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS if the owner dies or the bus
  // goes stale between bootstrap and dispatch.
  if (deps.refreshMessageBus) {
    messageBus = await deps.refreshMessageBus();
  }
  for (let attempt = 0; attempt < POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS; attempt += 1) {
    try {
      await deps.ensureStandaloneOwner(messageBus);
    } catch (err) {
      if (!isSharedMutationOwnerTimeoutError(err) || !deps.refreshMessageBus) {
        throw err;
      }
      messageBus = await deps.refreshMessageBus();
      await deps.ensureStandaloneOwner(messageBus);
    }
    if (deps.refreshMessageBus) {
      messageBus = await deps.refreshMessageBus();
    }
    if (await pollOwnerAndDispatch(args, deps, messageBus, waitForApproval, noTrack)) {
      return resolvedExitCode();
    }
    if (!deps.refreshMessageBus) {
      break;
    }
    messageBus = await deps.refreshMessageBus();
  }
  process.stderr.write(
    `${RED}Error:${RESET} Mutation command "${args[0] ?? ''}" could not reach a shared owner after bootstrap.\n`,
  );
  return 1;
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
