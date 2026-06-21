import type { NativeDatabaseCompat } from './sqlite-query.js';

export interface SQLiteWriteContext {
  db: NativeDatabaseCompat;
  readOnly: boolean;
  getTransactionDepth(): number;
  setTransactionDepth(depth: number): void;
  markDirty(): void;
}

export function ensureSQLiteWritable(readOnly: boolean): void {
  if (readOnly) {
    throw new Error('SQLiteAdapter is read-only in this process');
  }
}

/** Run an INSERT/UPDATE/DELETE. File-backed durability is handled by SQLite/WAL. */
export function runSQLiteWrite(
  db: NativeDatabaseCompat,
  readOnly: boolean,
  markDirty: () => void,
  sql: string,
  params: unknown[] = [],
): void {
  ensureSQLiteWritable(readOnly);
  db.run(sql, params as any[]);
  markDirty();
}

export function runSQLiteTransaction<T>(
  context: SQLiteWriteContext,
  work: () => T,
): T {
  ensureSQLiteWritable(context.readOnly);
  const depth = context.getTransactionDepth();
  context.db.run(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT invoker_nested_${depth}`);
  context.setTransactionDepth(depth + 1);
  try {
    const result = work();
    const nextDepth = context.getTransactionDepth() - 1;
    context.setTransactionDepth(nextDepth);
    context.db.run(nextDepth === 0 ? 'COMMIT' : `RELEASE invoker_nested_${nextDepth}`);
    context.markDirty();
    return result;
  } catch (err) {
    const nextDepth = Math.max(0, context.getTransactionDepth() - 1);
    context.setTransactionDepth(nextDepth);
    try {
      context.db.run(nextDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO invoker_nested_${nextDepth}`);
    } catch {
      // Preserve the original statement failure if SQLite already aborted the
      // transaction before we reached this cleanup path.
    }
    throw err;
  }
}
