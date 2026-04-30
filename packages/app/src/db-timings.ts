/**
 * DbTimings — phase-level aggregator for startup-relevant adapter/load
 * timings and delete timings emitted by the persistence, task-repository,
 * and command-service decorators.
 *
 * The aggregator is exposed on the `getUiPerfStats()` payload under the
 * `dbTimings` key so `--headless query ui-perf` and the
 * `invoker:get-ui-perf-stats` IPC channel surface end-to-end startup and
 * delete timings without changing delete semantics.
 */

import type {
  PersistenceInstrumentationEvent,
  PersistenceInstrumenter,
} from '@invoker/data-store';
import type {
  CommandServiceInstrumentationEvent,
  CommandServiceInstrumenter,
  TaskRepositoryInstrumentationEvent,
  TaskRepositoryInstrumenter,
} from '@invoker/workflow-core';

interface MutablePhaseTotals {
  count: number;
  totalMs: number;
  maxMs: number;
  errors: number;
}

export interface PhaseTotals {
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly errors: number;
}

export interface DbTimingsSnapshot {
  readonly startup: Readonly<Record<string, PhaseTotals>>;
  readonly delete: Readonly<Record<string, PhaseTotals>>;
}

const STARTUP_PERSISTENCE_METHODS = new Set([
  'listWorkflows',
  'loadWorkflow',
  'loadTasks',
]);

const DELETE_PERSISTENCE_METHODS = new Set([
  'deleteWorkflow',
  'deleteAllWorkflows',
]);

const DELETE_COMMAND_METHODS = new Set([
  'deleteWorkflow',
]);

const DELETE_TASK_REPOSITORY_METHODS = new Set([
  'deleteWorkflow',
  'deleteAllWorkflows',
]);

function emptyTotals(): MutablePhaseTotals {
  return { count: 0, totalMs: 0, maxMs: 0, errors: 0 };
}

function freezeTotals(totals: MutablePhaseTotals): PhaseTotals {
  return Object.freeze({
    count: totals.count,
    totalMs: totals.totalMs,
    maxMs: totals.maxMs,
    errors: totals.errors,
  });
}

export class DbTimings {
  private readonly startup = new Map<string, MutablePhaseTotals>();
  private readonly delete_ = new Map<string, MutablePhaseTotals>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Record a single phase observation. Public so callers can wrap their
   *  own pre-DB work (e.g. the GUI delete-workflow IPC handler that kills
   *  running tasks before delegating to CommandService). */
  record(
    category: 'startup' | 'delete',
    phase: string,
    durationMs: number,
    success: boolean,
  ): void {
    const bucket = category === 'startup' ? this.startup : this.delete_;
    let totals = bucket.get(phase);
    if (!totals) {
      totals = emptyTotals();
      bucket.set(phase, totals);
    }
    totals.count += 1;
    totals.totalMs += durationMs;
    if (durationMs > totals.maxMs) {
      totals.maxMs = durationMs;
    }
    if (!success) {
      totals.errors += 1;
    }
  }

  /** Time an async operation and record the duration under the given phase. */
  async timeAsync<T>(
    category: 'startup' | 'delete',
    phase: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = this.now();
    let success = true;
    try {
      return await fn();
    } catch (err) {
      success = false;
      throw err;
    } finally {
      this.record(category, phase, this.now() - start, success);
    }
  }

  /** Time a sync operation and record the duration under the given phase. */
  timeSync<T>(category: 'startup' | 'delete', phase: string, fn: () => T): T {
    const start = this.now();
    let success = true;
    try {
      return fn();
    } catch (err) {
      success = false;
      throw err;
    } finally {
      this.record(category, phase, this.now() - start, success);
    }
  }

  /** Clear all aggregates. Used by `query ui-perf --reset`. */
  reset(): void {
    this.startup.clear();
    this.delete_.clear();
  }

  /** Plain-object snapshot suitable for JSON serialization. */
  snapshot(): DbTimingsSnapshot {
    const dump = (bucket: Map<string, MutablePhaseTotals>): Record<string, PhaseTotals> => {
      const out: Record<string, PhaseTotals> = {};
      for (const [phase, totals] of bucket) {
        out[phase] = freezeTotals(totals);
      }
      return out;
    };
    return Object.freeze({
      startup: Object.freeze(dump(this.startup)),
      delete: Object.freeze(dump(this.delete_)),
    });
  }

  /** Build a `PersistenceInstrumenter` that routes startup-relevant adapter
   *  reads under `dbTimings.startup.<method>` and delete-relevant adapter
   *  writes under `dbTimings.delete.persistence.<method>`. Other methods are
   *  ignored so the payload stays focused on phases the task scopes. */
  toPersistenceInstrumenter(): PersistenceInstrumenter {
    return (event: PersistenceInstrumentationEvent) => {
      if (STARTUP_PERSISTENCE_METHODS.has(event.method)) {
        this.record('startup', `persistence.${event.method}`, event.durationMs, event.success);
        return;
      }
      if (DELETE_PERSISTENCE_METHODS.has(event.method)) {
        this.record('delete', `persistence.${event.method}`, event.durationMs, event.success);
      }
    };
  }

  /** Build a `TaskRepositoryInstrumenter` that records the delete-relevant
   *  repository writes under `dbTimings.delete.taskRepository.<method>`. */
  toTaskRepositoryInstrumenter(): TaskRepositoryInstrumenter {
    return (event: TaskRepositoryInstrumentationEvent) => {
      if (DELETE_TASK_REPOSITORY_METHODS.has(event.method)) {
        this.record(
          'delete',
          `taskRepository.${event.method}`,
          event.durationMs,
          event.success,
        );
      }
    };
  }

  /** Build a `CommandServiceInstrumenter` that records the delete-workflow
   *  mutation latency under `dbTimings.delete.commandService.deleteWorkflow`.
   *  Other lifecycle mutations are intentionally not folded into the
   *  startup/delete phases — those continue to flow through their own
   *  command-service log lines. */
  toCommandServiceInstrumenter(): CommandServiceInstrumenter {
    return (event: CommandServiceInstrumentationEvent) => {
      if (DELETE_COMMAND_METHODS.has(event.method)) {
        this.record(
          'delete',
          `commandService.${event.method}`,
          event.durationMs,
          event.success,
        );
      }
    };
  }
}
