import type { Database as SqlJsDatabase } from 'sql.js';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class SQLiteWriteHelper {
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private readonly flushDelayMs: number;
  private readonly flushWarnThresholdMs: number;
  private readonly flushWarnDbSizeBytes: number;
  private readonly flushWarnCooldownMs: number;
  private lastFlushWarnAtMs = 0;
  private writeTransactionDepth = 0;

  constructor(
    private readonly db: SqlJsDatabase,
    private readonly dbPath: string | null,
    private readonly readOnly: boolean,
  ) {
    this.flushDelayMs = this.dbPath
      ? Number(process.env.INVOKER_SQLITE_FLUSH_DEBOUNCE_MS ?? 0)
      : 0;
    this.flushWarnThresholdMs = Number(process.env.INVOKER_SQLITE_FLUSH_WARN_THRESHOLD_MS ?? 250);
    this.flushWarnDbSizeBytes = Number(process.env.INVOKER_SQLITE_FLUSH_WARN_DB_MB ?? 256) * 1024 * 1024;
    this.flushWarnCooldownMs = Number(process.env.INVOKER_SQLITE_FLUSH_WARN_COOLDOWN_MS ?? 60_000);
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  ensureWritable(): void {
    if (this.readOnly) {
      throw new Error('SQLiteAdapter is read-only in this process');
    }
  }

  /** Run an INSERT/UPDATE/DELETE and schedule a flush. */
  execRun(sql: string, params: unknown[] = []): void {
    this.ensureWritable();
    this.db.run(sql, params as any[]);
    this.markDirty();
  }

  runTransaction<T>(work: () => T): T {
    this.ensureWritable();
    this.db.run('BEGIN');
    this.writeTransactionDepth += 1;
    try {
      const result = work();
      this.writeTransactionDepth -= 1;
      this.db.run('COMMIT');
      this.markDirty();
      return result;
    } catch (err) {
      this.writeTransactionDepth = Math.max(0, this.writeTransactionDepth - 1);
      try {
        this.db.run('ROLLBACK');
      } catch {
        // Preserve the original statement failure if SQLite already aborted the
        // transaction before we reached this cleanup path.
      }
      throw err;
    }
  }

  markDirty(): void {
    this.dirty = true;
    if (this.writeTransactionDepth === 0) {
      this.scheduleFlush();
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  /** Flush DB to disk (no-op for :memory:). */
  private flush(): void {
    if (!this.dbPath || !this.dirty) return;
    const startedAt = Date.now();
    const dir = dirname(this.dbPath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.dbPath}.tmp`;
    const exported = Buffer.from(this.db.export());
    writeFileSync(tmpPath, exported);
    renameSync(tmpPath, this.dbPath);
    this.dirty = false;
    const elapsedMs = Date.now() - startedAt;
    const shouldWarnElapsed = Number.isFinite(this.flushWarnThresholdMs) && elapsedMs >= this.flushWarnThresholdMs;
    const shouldWarnSize = Number.isFinite(this.flushWarnDbSizeBytes) && exported.length >= this.flushWarnDbSizeBytes;
    if ((shouldWarnElapsed || shouldWarnSize) && Date.now() - this.lastFlushWarnAtMs >= this.flushWarnCooldownMs) {
      this.lastFlushWarnAtMs = Date.now();
      process.stderr.write(
        `[sqlite-flush] slow-or-large flush elapsedMs=${elapsedMs} sizeBytes=${exported.length} debounceMs=${this.flushDelayMs}\n`,
      );
    }
  }

  /** Debounced flush — coalesces rapid writes into a single I/O. */
  private scheduleFlush(): void {
    if (!this.dbPath) return;
    if (this.flushDelayMs <= 0) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.flush();
      return;
    }
    // Coalesce bursts onto the earliest pending flush to avoid timer churn.
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flush();
      this.flushTimer = null;
    }, this.flushDelayMs);
  }
}
