/**
 * Headless Transport — unified API for single and batch command execution.
 *
 * This module keeps the IPC-vs-standalone decision in one place.
 * Callers use `exec()` or `batchExec()` without knowing whether the
 * command runs locally (standalone mode) or is delegated over IPC to
 * a shared mutation owner.
 *
 * Mode selection:
 *   - Standalone: INVOKER_HEADLESS_STANDALONE=1 — commands execute in-process.
 *   - Shared-owner: default — commands are delegated over IPC to the owner.
 */

import type { MessageBus } from '@invoker/transport';

import { isHeadlessMutatingCommand } from './headless-command-classification.js';
import {
  tryDelegateExec,
  tryDelegateResume,
  tryDelegateRun,
  resolveDelegationTimeoutMs,
} from './headless-delegation.js';
import {
  discoverOwner,
  isOwnerReachable,
} from './owner-endpoint.js';

// ── Types ────────────────────────────────────────────────────

export type TransportMode = 'standalone' | 'shared-owner';

export interface ExecOptions {
  /** Override the detected mode. Useful for testing. */
  mode?: TransportMode;
  /** Wait for task approval before returning. */
  waitForApproval?: boolean;
  /** Suppress post-delegation tracking output. */
  noTrack?: boolean;
  /** Override delegation timeout (ms). */
  timeoutMs?: number;
}

export interface ExecResult {
  /** Whether the command was successfully dispatched. */
  ok: boolean;
  /** How the command was executed. */
  mode: TransportMode;
  /** Exit code when available (standalone mode). */
  exitCode?: number;
}

export interface BatchExecOptions extends ExecOptions {
  /** Stop executing remaining commands on first failure. Default: true. */
  stopOnFailure?: boolean;
}

export interface BatchExecResult {
  /** Per-command results in order. */
  results: ExecResult[];
  /** Whether all commands succeeded. */
  allOk: boolean;
}

export interface HeadlessTransportDeps {
  /** Message bus for IPC delegation. */
  messageBus: MessageBus;
  /** Execute a command in the host runtime (Electron headless). */
  runLocal: (args: string[]) => Promise<number>;
  /** Refresh the message bus connection. */
  refreshMessageBus?: () => Promise<MessageBus>;
}

// ── Mode resolution ──────────────────────────────────────────

/**
 * Resolve the transport mode from environment.
 * This is the single source of truth for the IPC-vs-standalone decision.
 */
export function resolveTransportMode(): TransportMode {
  return process.env.INVOKER_HEADLESS_STANDALONE === '1' ? 'standalone' : 'shared-owner';
}

// ── Transport implementation ─────────────────────────────────

/**
 * Execute a single headless command through the appropriate transport.
 *
 * In standalone mode, the command runs locally via `deps.runLocal`.
 * In shared-owner mode, the command is delegated to the owner over IPC.
 */
export async function exec(
  args: string[],
  deps: HeadlessTransportDeps,
  options: ExecOptions = {},
): Promise<ExecResult> {
  const mode = options.mode ?? resolveTransportMode();

  if (mode === 'standalone') {
    const exitCode = await deps.runLocal(args);
    return { ok: exitCode === 0, mode: 'standalone', exitCode };
  }

  // Shared-owner mode: delegate over IPC
  if (!isHeadlessMutatingCommand(args)) {
    // Non-mutating commands always run locally even in shared-owner mode
    const exitCode = await deps.runLocal(args);
    return { ok: exitCode === 0, mode: 'shared-owner', exitCode };
  }

  const delegated = await delegateCommand(args, deps, options);
  return { ok: delegated, mode: 'shared-owner' };
}

/**
 * Execute multiple headless commands sequentially through the transport.
 *
 * Uses the same mode resolution for all commands in the batch.
 * By default, stops on first failure.
 */
export async function batchExec(
  commands: string[][],
  deps: HeadlessTransportDeps,
  options: BatchExecOptions = {},
): Promise<BatchExecResult> {
  const stopOnFailure = options.stopOnFailure ?? true;
  const results: ExecResult[] = [];

  for (const args of commands) {
    const result = await exec(args, deps, options);
    results.push(result);
    if (!result.ok && stopOnFailure) {
      break;
    }
  }

  return {
    results,
    allOk: results.every((r) => r.ok),
  };
}

// ── Internal delegation ──────────────────────────────────────

async function delegateCommand(
  args: string[],
  deps: HeadlessTransportDeps,
  options: ExecOptions,
): Promise<boolean> {
  const { waitForApproval, noTrack, timeoutMs } = options;
  const command = args[0];

  // Verify owner is reachable before attempting delegation
  const owner = await discoverOwner(deps.messageBus, 3_000);
  if (!isOwnerReachable(owner)) {
    return false;
  }

  const resolvedTimeoutMs = timeoutMs ?? await resolveDelegationTimeoutMs(args);

  if (command === 'run') {
    const planPath = args[1];
    if (!planPath) return false;
    return tryDelegateRun(planPath, deps.messageBus, waitForApproval, noTrack, resolvedTimeoutMs);
  }

  if (command === 'resume') {
    const workflowId = args[1];
    if (!workflowId) return false;
    return tryDelegateResume(workflowId, deps.messageBus, waitForApproval, noTrack, resolvedTimeoutMs);
  }

  return tryDelegateExec(args, deps.messageBus, waitForApproval, noTrack, resolvedTimeoutMs);
}
