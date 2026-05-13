import type { TaskState } from '@invoker/workflow-core';

export interface ShutdownDiagnosticDb {
  getOutputTail(taskId: string): Array<{ data: string }>;
  appendTaskOutput(taskId: string, data: string): void;
  appendOutputChunk?(taskId: string, data: string): void;
}

/** Max characters of recent output tail included in shutdown diagnostics. */
export const SHUTDOWN_DIAGNOSTIC_TAIL_CHARS = 4_000;

export const STARTUP_DIAGNOSTIC_TAIL_CHARS = 4_000;

function compactTail(tailChunks: Array<{ data: string }>, limit: number): string {
  let tail = tailChunks.map(c => c.data).join('');
  if (tail.length > limit) {
    tail = '...' + tail.slice(tail.length - limit);
  }
  return tail;
}

/**
 * Persist a compact diagnostic block into durable task output so that
 * post-mortem inspection retains concrete context instead of collapsing
 * to "Application quit".
 *
 * Called from both headless and GUI shutdown paths before the synthetic
 * failure response is emitted.
 */
export function persistShutdownDiagnostic(
  task: TaskState,
  db: ShutdownDiagnosticDb,
  opts?: { flushPendingOutput?: (taskId: string) => void },
): void {
  try {
    // Flush any buffered output so the spool is up-to-date.
    opts?.flushPendingOutput?.(task.id);

    // Gather the most recent output tail from the output spool.
    const tail = compactTail(db.getOutputTail(task.id), SHUTDOWN_DIAGNOSTIC_TAIL_CHARS);

    const parts: string[] = ['\n[Shutdown Diagnostic]'];
    parts.push(`status=${task.status}`);
    if (task.execution.error) {
      parts.push(`error=${task.execution.error}`);
    }
    if (task.execution.exitCode !== undefined && task.execution.exitCode !== null) {
      parts.push(`exitCode=${task.execution.exitCode}`);
    }
    if (tail) {
      parts.push(`--- recent output tail ---\n${tail}`);
    }
    parts.push('--- end shutdown diagnostic ---\n');
    const diagnostic = parts.join('\n');
    db.appendTaskOutput(task.id, diagnostic);
    db.appendOutputChunk?.(task.id, diagnostic);
  } catch {
    // Best-effort: don't let diagnostic persistence block shutdown.
  }
}

/**
 * Persist concrete executor startup failure context into durable task output.
 * This supplements the terminal failed state without changing lifecycle status.
 */
export function persistStartupDiagnostic(
  taskId: string,
  db: ShutdownDiagnosticDb,
  details: {
    executorType: string;
    message: string;
    flushPendingOutput?: (taskId: string) => void;
  },
): void {
  try {
    details.flushPendingOutput?.(taskId);
    const tail = compactTail(db.getOutputTail(taskId), STARTUP_DIAGNOSTIC_TAIL_CHARS);
    const parts: string[] = ['\n[Startup Diagnostic]'];
    parts.push(`executor=${details.executorType}`);
    parts.push(`error=${details.message}`);
    if (tail) {
      parts.push(`--- recent output tail ---\n${tail}`);
    }
    parts.push('--- end startup diagnostic ---\n');
    const diagnostic = parts.join('\n');
    db.appendTaskOutput(taskId, diagnostic);
    db.appendOutputChunk?.(taskId, diagnostic);
  } catch {
    // Best-effort: preserve the original startup failure flow.
  }
}
