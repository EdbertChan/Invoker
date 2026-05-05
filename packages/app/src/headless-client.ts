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

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function delegationClientLog(message: string): void {
  process.stderr.write(`[headless-client] ${message}\n`);
}

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

/** Send a mutation command over IPC to the owner, using command-specific channels and timeouts. */
async function delegateMutation(
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
  delegationClientLog(
    `delegateMutation command=${command ?? '<missing>'} timeoutMs=${timeoutMs} noTrack=${noTrack ? 'true' : 'false'} waitForApproval=${waitForApproval ? 'true' : 'false'}`,
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

  // Use the resolver to wait for any reachable owner
  const resolver = createOwnerResolver(
    { messageBus: bus, refreshMessageBus, ensureStandaloneOwner: async () => {} },
    { discoveryTimeoutMs: 2_000 },
  );
  const ownerResult = await resolver.waitForAny(READ_ONLY_QUERY_OWNER_READY_TIMEOUT_MS);
  if (!ownerResult.resolved) {
    throw new Error(isUiPerf
      ? 'query ui-perf requires a running shared owner process'
      : 'query queue requires a running shared owner process');
  }

  let messageBus = ownerResult.bus;
  const deadline = Date.now() + READ_ONLY_QUERY_OWNER_READY_TIMEOUT_MS;
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

/** Poll for a standalone-capable owner post-bootstrap and delegate once it responds. */
async function delegateAfterBootstrap(
  args: string[],
  deps: Pick<HeadlessClientDeps, 'refreshMessageBus'>,
  bus: MessageBus,
  waitForApproval?: boolean,
  noTrack?: boolean,
): Promise<boolean> {
  const startedAt = Date.now();
  delegationClientLog(`post-bootstrap delegation loop begin timeoutMs=${POST_BOOTSTRAP_OWNER_READY_TIMEOUT_MS}`);
  const deadline = Date.now() + POST_BOOTSTRAP_OWNER_READY_TIMEOUT_MS;
  let messageBus = bus;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const owner = await discoverOwner(messageBus, 1_000);
    delegationClientLog(
      `post-bootstrap attempt=${attempts} ownerReachable=${isOwnerReachable(owner) ? 'true' : 'false'} standaloneCapable=${isStandaloneCapable(owner) ? 'true' : 'false'} ownerId=${owner?.ownerId ?? '<none>'}`,
    );
    if (isStandaloneCapable(owner) && await delegateMutation(
      args,
      messageBus,
      waitForApproval,
      noTrack,
      noTrack ? POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS : DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS,
    )) {
      delegationClientLog(`post-bootstrap delegation succeeded attempts=${attempts} elapsedMs=${Date.now() - startedAt}`);
      return true;
    }
    if (deps.refreshMessageBus) {
      messageBus = await deps.refreshMessageBus();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  delegationClientLog(`post-bootstrap delegation exhausted attempts=${attempts} elapsedMs=${Date.now() - startedAt}`);
  return false;
}

export interface HeadlessClientDeps {
  messageBus: MessageBus;
  ensureStandaloneOwner: (bus?: MessageBus) => Promise<void>;
  refreshMessageBus?: () => Promise<MessageBus>;
  runElectronHeadless: (args: string[]) => Promise<number>;
}

async function ensureStandaloneOwnerViaBootstrap(bus: MessageBus): Promise<void> {
  const invokerHomeRoot = resolveInvokerHomeRoot();
  const bootstrapLock = tryAcquireOwnerBootstrapLock(invokerHomeRoot);
  const startedAt = Date.now();
  delegationClientLog(`bootstrap begin lockAcquired=${bootstrapLock ? 'true' : 'false'} home=${invokerHomeRoot}`);
  try {
    if (bootstrapLock) {
      delegationClientLog('bootstrap spawning detached standalone owner');
      spawnDetachedStandaloneOwner(resolve(__dirname, '..', '..', '..'));
    }
    const deadline = Date.now() + standaloneOwnerBootstrapTimeoutMs();
    let attempts = 0;
    while (Date.now() < deadline) {
      attempts += 1;
      const owner = await discoverOwner(bus, 500);
      if (isStandaloneCapable(owner)) {
        delegationClientLog(
          `bootstrap owner ready attempts=${attempts} elapsedMs=${Date.now() - startedAt} ownerId=${owner.ownerId}`,
        );
        return;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    delegationClientLog(`bootstrap timeout elapsedMs=${Date.now() - startedAt}`);
    throw new SharedMutationOwnerTimeoutError();
  } finally {
    bootstrapLock?.release();
    delegationClientLog(`bootstrap end elapsedMs=${Date.now() - startedAt}`);
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
 * Resolve a writable owner and delegate the mutation command.
 *
 * Routing lanes (matches the shared transport policy):
 *   1. Standalone-capable owner already running → delegate immediately.
 *   2. GUI owner (non-standalone) already running → delegate to it (no bootstrap).
 *   3. No owner reachable → bootstrap a standalone owner, then delegate.
 */
async function resolveOwnerAndDelegate(
  args: string[],
  deps: HeadlessClientDeps,
  waitForApproval?: boolean,
  noTrack?: boolean,
): Promise<number | null> {
  const startedAt = Date.now();
  delegationClientLog(`resolveOwnerAndDelegate begin command=${args[0] ?? '<missing>'} noTrack=${noTrack ? 'true' : 'false'}`);
  let messageBus = deps.messageBus;
  const resolvedExitCode = (): number => {
    const exitCode = process.exitCode;
    return typeof exitCode === 'number' ? exitCode : 0;
  };

  // Lane 1: Standalone-capable owner — preferred target for mutations
  const owner = await discoverOwner(messageBus, 3_000);
  delegationClientLog(
    `discover standaloneCapable=${isStandaloneCapable(owner)} ownerReachable=${isOwnerReachable(owner)} ownerId=${owner?.ownerId ?? '<none>'}`,
  );
  if (isStandaloneCapable(owner)) {
    if (await delegateMutation(args, messageBus, waitForApproval, noTrack)) {
      delegationClientLog(`delegated to standalone owner elapsedMs=${Date.now() - startedAt}`);
      return resolvedExitCode();
    }
  }

  // Lane 2: GUI owner — delegate without bootstrapping a standalone process
  if (isOwnerReachable(owner) && await delegateMutation(args, messageBus, waitForApproval, noTrack)) {
    delegationClientLog(`delegated to GUI owner ownerId=${owner.ownerId} elapsedMs=${Date.now() - startedAt}`);
    return resolvedExitCode();
  }

  // Lane 3: No usable owner — bootstrap a standalone owner and delegate
  if (deps.refreshMessageBus) {
    messageBus = await deps.refreshMessageBus();
  }
  for (let attempt = 0; attempt < POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS; attempt += 1) {
    delegationClientLog(`bootstrap attempt=${attempt + 1}/${POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS}`);
    try {
      await deps.ensureStandaloneOwner(messageBus);
    } catch (err) {
      if (!isSharedMutationOwnerTimeoutError(err)) throw err;
      if (!deps.refreshMessageBus) throw err;
      delegationClientLog(`bootstrap timeout; refreshing bus attempt=${attempt + 1}`);
      messageBus = await deps.refreshMessageBus();
      await deps.ensureStandaloneOwner(messageBus);
    }
    if (deps.refreshMessageBus) {
      messageBus = await deps.refreshMessageBus();
    }
    if (await delegateAfterBootstrap(args, deps, messageBus, waitForApproval, noTrack)) {
      delegationClientLog(`post-bootstrap delegation succeeded attempt=${attempt + 1} elapsedMs=${Date.now() - startedAt}`);
      return resolvedExitCode();
    }
    if (!deps.refreshMessageBus) break;
    messageBus = await deps.refreshMessageBus();
  }

  delegationClientLog(`resolveOwnerAndDelegate failed elapsedMs=${Date.now() - startedAt}`);
  return null;
}

export async function runHeadlessClientCommand(
  argv: string[],
  deps: HeadlessClientDeps,
): Promise<number> {
  // Fail fast on malformed config before any IPC or process spawn.
  loadConfig();

  const { args, waitForApproval, noTrack } = parseArgs(argv);
  const standaloneMode = process.env.INVOKER_HEADLESS_STANDALONE === '1';
  const internalOwnerServe = args[0] === 'owner-serve';

  // Route 1: Read-only queries (queue, ui-perf) delegate to any live owner.
  if (!standaloneMode && !internalOwnerServe && await delegateReadOnlyQuery(args, deps.messageBus, deps.refreshMessageBus)) {
    const exitCode = process.exitCode;
    return typeof exitCode === 'number' ? exitCode : 0;
  }

  // Route 2: Non-mutating commands and standalone mode run in-process.
  if (!isHeadlessMutatingCommand(args) || standaloneMode || internalOwnerServe) {
    return deps.runElectronHeadless(argv);
  }

  // Route 3: Mutating commands delegate to a shared owner (bootstrap if needed).
  const result = await resolveOwnerAndDelegate(args, deps, waitForApproval, noTrack);
  if (result !== null) {
    return result;
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
