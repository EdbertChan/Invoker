/**
 * Revision-aware delta-merge logic for `lastKnownTaskStates`.
 *
 * Each cached entry tracks its revision so that `updated` deltas are only
 * applied when `previousRevision` matches.  Unknown tasks or revision gaps
 * quarantine the task and trigger an authoritative reload from persistence.
 * Deltas for quarantined tasks are ignored until the reload resolves.
 */
import type { TaskDelta, TaskState } from '@invoker/workflow-core';

// ── Public contracts ────────────────────────────────────────

/** Single-task authoritative read (backed by persistence / SQLite). */
export interface AuthoritativeTaskSource {
  getTask(taskId: string): TaskState | undefined;
}

/** Per-task cache entry: serialized snapshot + its revision. */
export interface CacheEntry {
  snapshot: string;
  revision: number;
}

/** Result of applying a delta — tells the caller what recovery action (if any) is needed. */
export type ApplyResult =
  | { action: 'applied' }
  | { action: 'created' }
  | { action: 'removed' }
  | { action: 'skipped'; reason: 'quarantined' | 'no_source' }
  | { action: 'quarantine'; taskId: string; reason: 'unknown_task' | 'revision_gap' };

// ── Core API ────────────────────────────────────────────────

/**
 * Apply a single TaskDelta to the revision-aware cache.
 *
 * @param delta          The incoming delta.
 * @param cache          Map of taskId → CacheEntry (snapshot + revision).
 * @param quarantined    Set of taskIds currently awaiting authoritative reload.
 * @returns              An `ApplyResult` describing what happened.
 */
export function applyDelta(
  delta: TaskDelta,
  cache: Map<string, CacheEntry>,
  quarantined: Set<string>,
): ApplyResult {
  if (delta.type === 'created') {
    const entry: CacheEntry = {
      snapshot: JSON.stringify(delta.task),
      revision: delta.task.revision,
    };
    cache.set(delta.task.id, entry);
    // If the task was quarantined, a fresh `created` resolves it.
    quarantined.delete(delta.task.id);
    return { action: 'created' };
  }

  if (delta.type === 'updated') {
    // Ignore deltas for quarantined tasks — wait for recovery.
    if (quarantined.has(delta.taskId)) {
      return { action: 'skipped', reason: 'quarantined' };
    }

    const entry = cache.get(delta.taskId);

    if (!entry) {
      // Unknown task: quarantine and request authoritative reload.
      quarantined.add(delta.taskId);
      return { action: 'quarantine', taskId: delta.taskId, reason: 'unknown_task' };
    }

    if (entry.revision !== delta.previousRevision) {
      // Revision gap: quarantine and request authoritative reload.
      quarantined.add(delta.taskId);
      return { action: 'quarantine', taskId: delta.taskId, reason: 'revision_gap' };
    }

    // Revision continuity matches — apply the delta.
    const prev = JSON.parse(entry.snapshot);
    const { config: cfgChanges, execution: execChanges, ...topLevel } = delta.changes;
    const merged = {
      ...prev,
      ...topLevel,
      revision: delta.revision,
      config: { ...prev.config, ...cfgChanges },
      execution: { ...prev.execution, ...execChanges },
    };
    cache.set(delta.taskId, {
      snapshot: JSON.stringify(merged),
      revision: delta.revision,
    });
    return { action: 'applied' };
  }

  if (delta.type === 'removed') {
    cache.delete(delta.taskId);
    quarantined.delete(delta.taskId);
    return { action: 'removed' };
  }

  // Exhaustiveness guard.
  return { action: 'skipped', reason: 'no_source' };
}

/**
 * Resolve a quarantined task by loading it from the authoritative source.
 *
 * Clears the quarantine flag and seeds the cache with the DB snapshot.
 * Returns the loaded task (or `undefined` if the task no longer exists).
 */
export function resolveQuarantine(
  taskId: string,
  cache: Map<string, CacheEntry>,
  quarantined: Set<string>,
  source: AuthoritativeTaskSource,
): TaskState | undefined {
  quarantined.delete(taskId);
  const task = source.getTask(taskId);
  if (task) {
    cache.set(taskId, {
      snapshot: JSON.stringify(task),
      revision: task.revision,
    });
  } else {
    cache.delete(taskId);
  }
  return task;
}

// ── Migration helpers ───────────────────────────────────────

/**
 * Build a revision-aware cache from a plain `Map<string, string>` snapshot map.
 *
 * Used during bootstrap / seeding when we have full task snapshots but no
 * CacheEntry wrappers yet.
 */
export function seedCache(tasks: TaskState[]): Map<string, CacheEntry> {
  const cache = new Map<string, CacheEntry>();
  for (const task of tasks) {
    cache.set(task.id, {
      snapshot: JSON.stringify(task),
      revision: task.revision,
    });
  }
  return cache;
}

/**
 * Convenience: read the serialized snapshot from a cache entry.
 */
export function getSnapshot(cache: Map<string, CacheEntry>, taskId: string): string | undefined {
  return cache.get(taskId)?.snapshot;
}
