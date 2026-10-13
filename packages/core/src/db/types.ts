export type SqlParam = string | number | bigint | boolean | null | Uint8Array;
export type SqlParams = SqlParam[] | Record<string, SqlParam>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export type DbDriver = 'node:sqlite' | 'sql.js';

/** Full-text search engine available in this SQLite build (FTS5 in Node, FTS4 in sql.js). */
export type FtsKind = 'fts5' | 'fts4' | 'none';

/**
 * Minimal synchronous SQLite facade shared by all drivers (ADR-02).
 * SQL placeholders: positional `?` or named `$name`.
 */
export interface Db {
  readonly driver: DbDriver;
  readonly path: string;
  exec(sql: string): void;
  run(sql: string, params?: SqlParams): RunResult;
  get<T = Record<string, unknown>>(sql: string, params?: SqlParams): T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParams): T[];
  transaction<T>(fn: () => T): T;
  sqliteVersion(): string;
  fts(): FtsKind;
  /** Persist to disk now (sql.js); no-op for node:sqlite. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

export const MEMORY_DB = ':memory:';

/** Normalise params so every driver gets what it understands. */
export function normalizeParams(params?: SqlParams): SqlParams | undefined {
  if (params === undefined) return undefined;
  const norm = (v: SqlParam): SqlParam => (typeof v === 'boolean' ? (v ? 1 : 0) : v);
  if (Array.isArray(params)) return params.map(norm);
  const out: Record<string, SqlParam> = {};
  for (const [k, v] of Object.entries(params)) {
    const key = k.startsWith('$') || k.startsWith(':') || k.startsWith('@') ? k : `$${k}`;
    out[key] = norm(v);
  }
  return out;
}

export function probeFts(db: Pick<Db, 'exec'>): FtsKind {
  for (const kind of ['fts5', 'fts4'] as const) {
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.__sindar_fts_probe USING ${kind}(x)`);
      db.exec('DROP TABLE IF EXISTS temp.__sindar_fts_probe');
      return kind;
    } catch {
      /* try the next engine */
    }
  }
  return 'none';
}
