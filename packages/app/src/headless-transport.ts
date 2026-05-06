/**
 * Headless Transport — single entry point for executing headless commands.
 *
 * This module centralizes the IPC-vs-standalone decision. Callers use
 * `execHeadless` (single command) or `execHeadlessBatch` (multiple commands)
 * without knowing whether commands run locally or delegate to a shared owner.
 *
 * Decision logic:
 *   1. Standalone mode (INVOKER_HEADLESS_STANDALONE=1) → run locally.
 *   2. Shared-owner mode → discover owner via IPC, bootstrap if needed,
 *      then delegate the command over the message bus.
 *
 * This module does NOT move any scripts. It wraps existing delegation and
 * owner-discovery primitives into a composable API.
 */

import type { MessageBus } from '@invoker/transport';

import { isHeadlessMutatingCommand } from './headless-command-classification.js';
import {
  resolveDelegationTimeoutMs,
  tryDelegateExec,
  tryDelegateRun,
  tryDelegateResume,
} from './headless-delegation.js';
import {
  discoverOwner,
  isOwnerReachable,
  isStandaloneCapable,
} from './owner-endpoint.js';

// ── Types ────────────────────────────────────────────────────

/** Options for a single headless execution. */
export interface HeadlessExecOptions {
  /** Wait for human approval gates before returning. */
  waitForApproval?: boolean;
  /** Return immediately after submitting; do not track execution. */
  noTrack?: boolean;
}

/** Result of a single headless execution attempt. */
export type HeadlessExecResult =
  | { kind: 'delegated' }
  | { kind: 'local'; exitCode: number }
  | { kind: 'failed'; reason: string };

/** A command descriptor for batch execution. */
export interface HeadlessBatchItem {
  /** Raw CLI args (e.g. ['retry', 'wf-1']). */
  args: string[];
  /** Per-command options (override batch-level defaults). */
  options?: HeadlessExecOptions;
}

/** Result of a batch execution. One entry per submitted command. */
export interface HeadlessBatchResult {
  results: HeadlessExecResult[];
}

/** Transport mode resolved at runtime. */
export type TransportMode = 'standalone' | 'shared-owner';

/** Dependencies injected into the transport layer. */
export interface HeadlessTransportDeps {
  /** Current message bus for IPC communication. */
  messageBus: MessageBus;
  /** Run the command locally (standalone mode). */
  runLocally: (args: string[]) => Promise<number>;
  /** Bootstrap a standalone owner process if none is available. */
  ensureStandaloneOwner: (bus?: MessageBus) => Promise<void>;
  /** Reconnect the message bus (stale connection recovery). */
  refreshMessageBus?: () => Promise<MessageBus>;
}

// ── Mode resolution ──────────────────────────────────────────

/**
 * Resolve which transport mode to use. This is the ONE place
 * that decides IPC vs standalone.
 */
export function resolveTransportMode(): TransportMode {
  if (process.env.INVOKER_HEADLESS_STANDALONE === '1') {
    return 'standalone';
  }
  return 'shared-owner';
}

// ── Single exec ──────────────────────────────────────────────

/**
 * Execute a single headless command. Routes to local execution or
 * IPC delegation based on the resolved transport mode.
 */
export async function execHeadless(
  args: string[],
  deps: HeadlessTransportDeps,
  options: HeadlessExecOptions = {},
): Promise<HeadlessExecResult> {
  const mode = resolveTransportMode();

  // Standalone always runs locally
  if (mode === 'standalone') {
    const exitCode = await deps.runLocally(args);
    return { kind: 'local', exitCode };
  }

  // Non-mutating commands run locally regardless of mode
  if (!isHeadlessMutatingCommand(args)) {
    const exitCode = await deps.runLocally(args);
    return { kind: 'local', exitCode };
  }

  // Shared-owner: attempt IPC delegation
  const delegated = await tryDelegateToOwner(args, deps, options);
  if (delegated) {
    return { kind: 'delegated' };
  }

  return { kind: 'failed', reason: 'Could not reach a shared owner to delegate the command' };
}

// ── Batch exec ───────────────────────────────────────────────

/**
 * Execute multiple headless commands in sequence. Each command is
 * routed independently through the transport mode resolution.
 *
 * In shared-owner mode, all commands delegate to the same owner.
 * In standalone mode, commands run locally in order.
 */
export async function execHeadlessBatch(
  items: HeadlessBatchItem[],
  deps: HeadlessTransportDeps,
  defaultOptions: HeadlessExecOptions = {},
): Promise<HeadlessBatchResult> {
  const results: HeadlessExecResult[] = [];
  for (const item of items) {
    const merged: HeadlessExecOptions = { ...defaultOptions, ...item.options };
    const result = await execHeadless(item.args, deps, merged);
    results.push(result);
  }
  return { results };
}

// ── Internal delegation ──────────────────────────────────────

const DEFAULT_DELEGATION_TIMEOUT_MS = 5_000;
const POST_BOOTSTRAP_OWNER_READY_TIMEOUT_MS = 20_000;

/**
 * Attempt to delegate a mutating command to a shared owner.
 *
 * Discovery → delegate → bootstrap → delegate retry.
 */
async function tryDelegateToOwner(
  args: string[],
  deps: HeadlessTransportDeps,
  options: HeadlessExecOptions,
): Promise<boolean> {
  let messageBus = deps.messageBus;

  // Phase 1: Try immediate delegation to an existing owner
  const owner = await discoverOwner(messageBus, 3_000);
  if (isOwnerReachable(owner)) {
    if (await delegateCommand(args, messageBus, options)) {
      return true;
    }
  }

  // Phase 2: Refresh bus and retry
  if (deps.refreshMessageBus) {
    messageBus = await deps.refreshMessageBus();
    const refreshedOwner = await discoverOwner(messageBus, 1_000);
    if (isOwnerReachable(refreshedOwner)) {
      if (await delegateCommand(args, messageBus, options)) {
        return true;
      }
    }
  }

  // Phase 3: Bootstrap owner, then delegate
  try {
    await deps.ensureStandaloneOwner(messageBus);
  } catch {
    return false;
  }

  if (deps.refreshMessageBus) {
    messageBus = await deps.refreshMessageBus();
  }

  // Poll for the bootstrapped owner to become ready
  const deadline = Date.now() + POST_BOOTSTRAP_OWNER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const bootstrappedOwner = await discoverOwner(messageBus, 1_000);
    if (isStandaloneCapable(bootstrappedOwner)) {
      if (await delegateCommand(args, messageBus, options)) {
        return true;
      }
    }
    if (deps.refreshMessageBus) {
      messageBus = await deps.refreshMessageBus();
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return false;
}

/**
 * Dispatch a single command to the owner via the appropriate channel.
 */
async function delegateCommand(
  args: string[],
  messageBus: MessageBus,
  options: HeadlessExecOptions,
): Promise<boolean> {
  const command = args[0];
  const timeoutMs = options.noTrack
    ? DEFAULT_DELEGATION_TIMEOUT_MS
    : command === 'run' || command === 'resume'
      ? DEFAULT_DELEGATION_TIMEOUT_MS
      : await resolveDelegationTimeoutMs(args);

  if (command === 'run') {
    const planPath = args[1];
    if (!planPath) return false;
    return tryDelegateRun(planPath, messageBus, options.waitForApproval, options.noTrack, timeoutMs);
  }
  if (command === 'resume') {
    const workflowId = args[1];
    if (!workflowId) return false;
    return tryDelegateResume(workflowId, messageBus, options.waitForApproval, options.noTrack, timeoutMs);
  }
  return tryDelegateExec(args, messageBus, options.waitForApproval, options.noTrack, timeoutMs);
}
