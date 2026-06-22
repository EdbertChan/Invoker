import { type NativeDatabaseCompat, paramsToArgs } from './sqlite-connection.js';

export class SQLiteQueryHelper {
  constructor(private readonly db: NativeDatabaseCompat) {}

  /** Run a single-row SELECT, returning the row as an object or undefined. */
  queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(sql);
    try {
      return stmt.get(...(paramsToArgs(params) as any[])) as Record<string, unknown> | undefined;
    } finally {
      stmt.free();
    }
  }

  /** Run a multi-row SELECT, returning an array of row objects. */
  queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    try {
      return stmt.all(...(paramsToArgs(params) as any[])) as Record<string, unknown>[];
    } finally {
      stmt.free();
    }
  }
}
