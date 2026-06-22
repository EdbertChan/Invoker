import type { NativeDatabaseCompat } from './sqlite-connection.js';

export class SQLiteWriteHelper {
  private transactionDepth = 0;

  constructor(
    private readonly db: NativeDatabaseCompat,
    private readonly isReadOnly: () => boolean,
    private readonly markDirty: () => void,
  ) {}

  ensureWritable(): void {
    if (this.isReadOnly()) {
      throw new Error('SQLiteAdapter is read-only in this process');
    }
  }

  /** Run an INSERT/UPDATE/DELETE. File-backed durability is handled by SQLite/WAL. */
  execRun(sql: string, params: unknown[] = []): void {
    this.ensureWritable();
    this.db.run(sql, params as any[]);
    this.markDirty();
  }

  runTransaction<T>(work: () => T): T {
    this.ensureWritable();
    this.db.run(this.transactionDepth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT invoker_nested_${this.transactionDepth}`);
    this.transactionDepth += 1;
    try {
      const result = work();
      this.transactionDepth -= 1;
      this.db.run(this.transactionDepth === 0 ? 'COMMIT' : `RELEASE invoker_nested_${this.transactionDepth}`);
      this.markDirty();
      return result;
    } catch (err) {
      this.transactionDepth = Math.max(0, this.transactionDepth - 1);
      try {
        this.db.run(this.transactionDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO invoker_nested_${this.transactionDepth}`);
      } catch {
        // Preserve the original statement failure if SQLite already aborted the
        // transaction before we reached this cleanup path.
      }
      throw err;
    }
  }
}
