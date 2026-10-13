import fs from 'node:fs';
import {
  MEMORY_DB,
  normalizeParams,
  probeFts,
  type Db,
  type FtsKind,
  type RunResult,
  type SqlParams,
} from './types.js';

type NodeSqliteModule = typeof import('node:sqlite');

let cached: NodeSqliteModule | null | undefined;

// Built as a runtime string so bundlers (esbuild) cannot "optimise" the `node:` prefix away —
// `sqlite` without the prefix is not a valid specifier, only `node:sqlite` is.
const NODE_SQLITE_SPECIFIER = ['node', 'sqlite'].join(':');

/** Returns the `node:sqlite` module, or null when this runtime lacks it. */
export async function loadNodeSqlite(): Promise<NodeSqliteModule | null> {
  if (cached !== undefined) return cached;
  try {
    cached = (await import(NODE_SQLITE_SPECIFIER)) as NodeSqliteModule;
  } catch {
    cached = null;
  }
  return cached;
}

export async function openNodeSqlite(file: string): Promise<Db> {
  const mod = await loadNodeSqlite();
  if (!mod) throw new Error('node:sqlite is not available in this Node.js runtime');
  const raw = new mod.DatabaseSync(file);

  if (file !== MEMORY_DB) {
    restrictPermissions(file);
    try {
      raw.exec('PRAGMA journal_mode = WAL');
    } catch {
      /* some filesystems (e.g. shared storage on Android) reject WAL — fine */
    }
  }
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA synchronous = NORMAL');

  const bind = (sql: string, params?: SqlParams) => {
    const stmt = raw.prepare(sql);
    const p = normalizeParams(params);
    return { stmt, args: p === undefined ? [] : Array.isArray(p) ? p : [p] };
  };

  let fts: FtsKind | undefined;

  const db: Db = {
    driver: 'node:sqlite',
    path: file,
    exec: (sql) => raw.exec(sql),
    run: (sql, params) => {
      const { stmt, args } = bind(sql, params);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (stmt.run as any)(...args) as RunResult;
      return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
    },
    get: (sql, params) => {
      const { stmt, args } = bind(sql, params);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (stmt.get as any)(...args) as never;
    },
    all: (sql, params) => {
      const { stmt, args } = bind(sql, params);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (stmt.all as any)(...args) as never;
    },
    transaction: (fn) => {
      raw.exec('BEGIN');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        try {
          raw.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        throw err;
      }
    },
    sqliteVersion: () =>
      String((raw.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v),
    fts: () => (fts ??= probeFts({ exec: (s) => raw.exec(s) })),
    flush: async () => {},
    close: async () => raw.close(),
  };
  return db;
}

/** Conversations are private: keep the database file owner-only (no-op on Windows). */
export function restrictPermissions(file: string): void {
  if (process.platform === 'win32') return;
  try {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
}
