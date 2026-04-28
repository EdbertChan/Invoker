import { resolve as resolvePath } from 'node:path';

import type { MessageBus } from '@invoker/transport';
import type { TaskState } from '@invoker/workflow-core';

import {
  resolveHeadlessTarget,
  type HeadlessTargetLookup,
} from './headless-command-classification.js';
import { createDelegatedTaskFeed, trackWorkflow } from './headless-watch.js';

type DelegateTrackingOptions = {
  waitForApproval?: boolean;
  noTrack?: boolean;
  timeoutMs?: number;
};

export async function tryDelegateRun(
  planPath: string,
  messageBus: MessageBus,
  waitForApproval?: boolean,
  noTrack?: boolean,
  timeoutMs?: number,
): Promise<boolean> {
  return tryDelegate(
    'headless.run',
    { planPath: resolvePath(planPath) },
    messageBus,
    { waitForApproval, noTrack, timeoutMs: timeoutMs ?? 5_000 },
  );
}

export async function tryDelegateResume(
  workflowId: string,
  messageBus: MessageBus,
  waitForApproval?: boolean,
  noTrack?: boolean,
  timeoutMs?: number,
): Promise<boolean> {
  return tryDelegate(
    'headless.resume',
    { workflowId },
    messageBus,
    { waitForApproval, noTrack, timeoutMs: timeoutMs ?? 5_000 },
  );
}

function usesExtendedDelegationTimeout(command: string): boolean {
  return command === 'rebase' || command === 'rebase-and-retry' || command === 'restart';
}

function looksLikeWorkflowId(target: unknown): boolean {
  return /^wf-[^/]+$/.test(String(target ?? ''));
}

export function delegationTimeoutMs(
  args: string[],
  targetLookup: HeadlessTargetLookup,
): number {
  const command = args[0] ?? '';
  if (!usesExtendedDelegationTimeout(command)) {
    return 5_000;
  }

  const resolvedTarget = resolveHeadlessTarget(args[1], targetLookup);
  if (resolvedTarget.kind === 'workflow') {
    return 60_000;
  }
  return 5_000;
}

export async function resolveDelegationTimeoutMs(args: string[]): Promise<number> {
  const command = args[0] ?? '';
  if (!usesExtendedDelegationTimeout(command)) {
    return 5_000;
  }
  return looksLikeWorkflowId(args[1]) ? 60_000 : 5_000;
}

export async function tryDelegateExec(
  args: string[],
  messageBus: MessageBus,
  waitForApproval?: boolean,
  noTrack?: boolean,
  timeoutMs?: number,
): Promise<boolean> {
  const resolvedTimeoutMs = timeoutMs ?? await resolveDelegationTimeoutMs(args);
  return tryDelegate(
    'headless.exec',
    { args, waitForApproval, noTrack },
    messageBus,
    { waitForApproval, noTrack, timeoutMs: resolvedTimeoutMs },
  );
}

/**
 * Dispatch a mutating command to the owner via the correct IPC channel.
 *
 * Handles the command→channel mapping (run → headless.run, resume →
 * headless.resume, everything else → headless.exec) so callers don't
 * need to duplicate that routing.
 */
export async function dispatchToOwner(
  args: string[],
  bus: MessageBus,
  options: { waitForApproval?: boolean; noTrack?: boolean; timeoutMs?: number },
): Promise<boolean> {
  const command = args[0] ?? '';
  const { waitForApproval, noTrack, timeoutMs } = options;

  if (command === 'run') {
    const planPath = args[1];
    if (!planPath) return false;
    return tryDelegateRun(planPath, bus, waitForApproval, noTrack, timeoutMs);
  }

  if (command === 'resume') {
    const workflowId = args[1];
    if (!workflowId) return false;
    return tryDelegateResume(workflowId, bus, waitForApproval, noTrack, timeoutMs);
  }

  return tryDelegateExec(args, bus, waitForApproval, noTrack, timeoutMs);
}

export async function tryPingHeadlessOwner(
  messageBus: MessageBus,
  timeoutMs = 1_000,
): Promise<{ ownerId?: string; mode?: string } | null> {
  const DELEGATION_TIMEOUT = Symbol('delegation-timeout');
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof DELEGATION_TIMEOUT>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(DELEGATION_TIMEOUT), timeoutMs);
    timeoutHandle.unref?.();
  });

  try {
    const response = await Promise.race([
      messageBus.request('headless.owner-ping', {}),
      timeoutPromise,
    ]) as { ownerId?: string; mode?: string };
    return response;
  } catch (err) {
    if (err === DELEGATION_TIMEOUT) return null;
    if (err instanceof Error && err.message.includes('No request handler registered for channel')) {
      return null;
    }
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export async function tryDelegateQueryUiPerf(
  messageBus: MessageBus,
  reset?: boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown> | null> {
  return tryDelegateQuery(messageBus, { kind: 'ui-perf', reset }, timeoutMs);
}

export async function tryDelegateQuery(
  messageBus: MessageBus,
  payload: Record<string, unknown>,
  timeoutMs = 5_000,
): Promise<Record<string, unknown> | null> {
  const DELEGATION_TIMEOUT = Symbol('delegation-timeout');
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof DELEGATION_TIMEOUT>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(DELEGATION_TIMEOUT), timeoutMs);
    timeoutHandle.unref?.();
  });

  try {
    const response = await Promise.race([
      messageBus.request('headless.query', payload),
      timeoutPromise,
    ]) as Record<string, unknown>;
    return response;
  } catch (err) {
    if (err === DELEGATION_TIMEOUT) return null;
    if (err instanceof Error && err.message.includes('No request handler registered for channel')) {
      return null;
    }
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function tryDelegate(
  channel: string,
  payload: unknown,
  messageBus: MessageBus,
  options: DelegateTrackingOptions,
): Promise<boolean> {
  let targetWorkflowId: string | undefined;
  const DELEGATION_TIMEOUT = Symbol('delegation-timeout');
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof DELEGATION_TIMEOUT>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(DELEGATION_TIMEOUT), options.timeoutMs ?? 5_000);
    timeoutHandle.unref?.();
  });

  let response: { workflowId: string; tasks: TaskState[] } | { ok: true };
  try {
    response = await Promise.race([
      messageBus.request<typeof payload, typeof response>(channel, payload),
      timeoutPromise,
    ]) as { workflowId: string; tasks: TaskState[] } | { ok: true };
  } catch (err) {
    if (err === DELEGATION_TIMEOUT) {
      return false;
    }
    if (err instanceof Error && err.message.includes('No request handler registered for channel')) {
      return false;
    }
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  if ('workflowId' in response) {
    targetWorkflowId = response.workflowId;
    process.stdout.write(`Delegated to owner — workflow: ${targetWorkflowId}\n`);
  } else {
    process.stdout.write('Delegated to owner\n');
  }

  if (options.noTrack) {
    process.stdout.write('[headless] --no-track enabled: delegated submission accepted; exiting without tracking.\n');
    return true;
  }

  if (!('workflowId' in response) || !Array.isArray(response.tasks)) {
    return true;
  }
  targetWorkflowId = response.workflowId;
  const taskFeed = createDelegatedTaskFeed(messageBus, response.tasks, targetWorkflowId);
  await trackWorkflow({
    workflowId: targetWorkflowId,
    loadTasks: taskFeed.loadTasks,
    messageBus,
    waitForApproval: options.waitForApproval,
    printSnapshot: true,
    printSummary: true,
    printTaskOutput: true,
    subscribeToChanges: taskFeed.subscribeToChanges,
  });
  return true;
}
