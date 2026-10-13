/**
 * sql.js (SQLite compiled to WebAssembly) fallback — pure JS, runs anywhere
 * (Termux builds of Node without `node:sqlite`, WebViews, odd platforms).
 * The whole database lives in memory and is persisted to disk after writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  MEMORY_DB,
  normalizeParams,
  probeFts,
  type Db,
  type FtsKind,
  type SqlParams,
} from './types.js';

type SqlJsStatic = import('sql.js').SqlJsStatic;
type SqlJsDatabase = import('sql.js').Database;

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

const isWrite = (sql: string) => !/^\s*(select|pragma|explain|with)\b/i.test(sql);

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const mod = await import('sql.js');
      const init =
        (mod as unknown as { default: typeof import('sql.js').default }).default ?? (mod as never);
      const require = createRequire(import.meta.url);
      let wasmPath: string | undefined;
      try {
        wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
      } catch {
        wasmPath = undefined;
      }
      return init(wasmPath ? { locateFile: () => wasmPath as string } : {});
    })();
  }
  return sqlJsPromise;
}

export async function openSqlJs(file: string, opts: { saveDebounceMs?: number } = {}): Promise<Db> {
  const SQL = await loadSqlJs();
  const inMemory = file === MEMORY_DB;
  let raw: SqlJsDatabase;
  if (!inMemory && fs.existsSync(file)) raw = new SQL.Database(fs.readFileSync(file));
  else raw = new SQL.Database();

  raw.exec('PRAGMA foreign_keys = ON');

  const debounceMs = opts.saveDebounceMs ?? 250;
  let dirty = false;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const saveNow = () => {
    if (inMemory || closed || !dirty) return;
    const data = raw.export();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, Buffer.from(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
    dirty = false;
  };
  const scheduleSave = () => {
    dirty = true;
    if (inMemory) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      try {
        saveNow();
      } catch {
        /* retried on next write/flush/close */
      }
    }, debounceMs);
    timer.unref?.();
  };
  const onExit = () => {
    try {
      saveNow();
    } catch {
      /* best effort */
    }
  };
  if (!inMemory) process.once('exit', onExit);

  const bindAll = <T>(sql: string, params: SqlParams | undefined, collect: boolean): T[] => {
    const stmt = raw.prepare(sql);
    try {
      const p = normalizeParams(params);
      if (p !== undefined) stmt.bind(p as never);
      const rows: T[] = [];
      while (stmt.step()) {
        if (collect) rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  };

  let fts: FtsKind | undefined;

  const db: Db = {
    driver: 'sql.js',
    path: file,
    exec: (sql) => {
      raw.exec(sql);
      if (isWrite(sql)) scheduleSave();
    },
    run: (sql, params) => {
      bindAll(sql, params, false);
      const changes = raw.getRowsModified();
      const row = raw.exec('SELECT last_insert_rowid() AS id')[0];
      const lastInsertRowid = Number(row?.values[0]?.[0] ?? 0);
      if (isWrite(sql)) scheduleSave();
      return { changes, lastInsertRowid };
    },
    get: (sql, params) => bindAll<never>(sql, params, true)[0],
    all: (sql, params) => bindAll<never>(sql, params, true),
    transaction: (fn) => {
      raw.exec('BEGIN');
      try {
        const out = fn();
        raw.exec('COMMIT');
        scheduleSave();
        return out;
      } catch (err) {
        try {
          raw.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      }
    },
    sqliteVersion: () => String(raw.exec('SELECT sqlite_version()')[0]?.values[0]?.[0] ?? '?'),
    fts: () => (fts ??= probeFts({ exec: (s) => raw.exec(s) })),
    flush: async () => saveNow(),
    close: async () => {
      if (closed) return;
      if (timer) clearTimeout(timer);
      saveNow();
      closed = true;
      process.off('exit', onExit);
      raw.close();
    },
  };
  return db;
}
