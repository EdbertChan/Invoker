type SQLiteWriteParams = unknown[];

export interface SQLiteWriteDatabase {
  run(sql: string, params?: SQLiteWriteParams): void;
}

export interface SQLiteWriteState {
  readonly readOnly: boolean;
  writeTransactionDepth: number;
  readonly db: SQLiteWriteDatabase;
  markDirty(): void;
}

export function ensureWritable(readOnly: boolean): void {
  if (readOnly) {
    throw new Error('SQLiteAdapter is read-only in this process');
  }
}

export function execRun(state: SQLiteWriteState, sql: string, params: SQLiteWriteParams = []): void {
  ensureWritable(state.readOnly);
  state.db.run(sql, params);
  state.markDirty();
}

export function runTransaction<T>(state: SQLiteWriteState, work: () => T): T {
  ensureWritable(state.readOnly);
  state.db.run(state.writeTransactionDepth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT invoker_nested_${state.writeTransactionDepth}`);
  state.writeTransactionDepth += 1;
  try {
    const result = work();
    state.writeTransactionDepth -= 1;
    state.db.run(state.writeTransactionDepth === 0 ? 'COMMIT' : `RELEASE invoker_nested_${state.writeTransactionDepth}`);
    state.markDirty();
    return result;
  } catch (err) {
    state.writeTransactionDepth = Math.max(0, state.writeTransactionDepth - 1);
    try {
      state.db.run(state.writeTransactionDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO invoker_nested_${state.writeTransactionDepth}`);
    } catch {
      // Preserve the original statement failure if SQLite already aborted the
      // transaction before we reached this cleanup path.
    }
    throw err;
  }
}
