import type { DatabaseSync, StatementSync } from 'node:sqlite';

export type NativeSqlite = typeof import('node:sqlite');
export type SQLiteParams = unknown[] | Record<string, unknown>;

let nativeSqlite: Promise<NativeSqlite> | undefined;
const nativeSqliteSpecifier = 'node:' + 'sqlite';

export function loadNativeSqlite(): Promise<NativeSqlite> {
  nativeSqlite ??= import(nativeSqliteSpecifier) as Promise<NativeSqlite>;
  return nativeSqlite;
}

function normalizeParams(params: SQLiteParams = []): unknown[] | Record<string, unknown> {
  return Array.isArray(params) ? params : params;
}

export function paramsToArgs(params: SQLiteParams = []): unknown[] {
  return Array.isArray(params) ? params : [params];
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

class NativeStatementCompat {
  private boundParams: SQLiteParams = [];
  private iterator: Iterator<Record<string, unknown>> | null = null;
  private current: Record<string, unknown> | undefined;

  constructor(private readonly stmt: StatementSync) {}

  bind(params: SQLiteParams = []): void {
    this.boundParams = normalizeParams(params);
    this.iterator = null;
    this.current = undefined;
  }

  step(): boolean {
    if (!this.iterator) {
      this.iterator = this.stmt.iterate(...(paramsToArgs(this.boundParams) as any[])) as Iterator<Record<string, unknown>>;
    }
    const next = this.iterator.next();
    this.current = next.done ? undefined : next.value;
    return !next.done;
  }

  getAsObject(): Record<string, unknown> {
    return this.current ?? {};
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.stmt.get(...(params as any[])) as Record<string, unknown> | undefined;
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.stmt.all(...(params as any[])) as Record<string, unknown>[];
  }

  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.stmt.run(...(params as any[]));
  }

  free(): void {
    this.iterator = null;
    this.current = undefined;
  }
}

export class NativeDatabaseCompat {
  private lastChanges = 0;

  constructor(private readonly db: DatabaseSync) {}

  run(sql: string, params: SQLiteParams = []): void {
    const trimmed = sql.trim();
    if (Array.isArray(params) && params.length === 0 && !trimmed.includes('?') && trimmed.split(';').filter(Boolean).length > 1) {
      this.db.exec(sql);
      this.lastChanges = 0;
      return;
    }
    const result = this.db.prepare(sql).run(...(paramsToArgs(params) as any[]));
    this.lastChanges = Number(result.changes);
  }

  prepare(sql: string): NativeStatementCompat {
    return new NativeStatementCompat(this.db.prepare(sql));
  }

  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }> {
    const trimmed = sql.trim();
    if (/^(?:SELECT|PRAGMA)\b/i.test(trimmed)) {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all() as Record<string, unknown>[];
      const columns = stmt.columns().map((column) => column.name);
      return [{ columns, values: rows.map((row) => columns.map((column) => row[column])) }];
    }
    this.db.exec(sql);
    this.lastChanges = 0;
    return [];
  }

  getRowsModified(): number {
    return this.lastChanges;
  }

  close(): void {
    this.db.close();
  }
}

/** Run a single-row SELECT, returning the row as an object or undefined. */
export function queryOne(
  db: NativeDatabaseCompat,
  sql: string,
  params: unknown[] = [],
): Record<string, unknown> | undefined {
  const stmt = db.prepare(sql);
  try {
    return stmt.get(...(paramsToArgs(params) as any[])) as Record<string, unknown> | undefined;
  } finally {
    stmt.free();
  }
}

/** Run a multi-row SELECT, returning an array of row objects. */
export function queryAll(
  db: NativeDatabaseCompat,
  sql: string,
  params: unknown[] = [],
): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  try {
    return stmt.all(...(paramsToArgs(params) as any[])) as Record<string, unknown>[];
  } finally {
    stmt.free();
  }
}
