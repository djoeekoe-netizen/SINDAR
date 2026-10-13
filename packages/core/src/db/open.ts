import fs from 'node:fs';
import path from 'node:path';
import { loadNodeSqlite, openNodeSqlite } from './node-sqlite.js';
import { openSqlJs } from './sqljs.js';
import { migrate, type MigrateResult } from './migrations.js';
import { MEMORY_DB, type Db, type DbDriver } from './types.js';

export interface OpenDatabaseOptions {
  /** Force a driver (default: node:sqlite when available, else sql.js). */
  driver?: DbDriver | 'auto';
  /** Run pending migrations (default: true). */
  migrate?: boolean;
}

export interface OpenedDatabase {
  db: Db;
  migration: MigrateResult | null;
}

export async function detectDriver(): Promise<DbDriver> {
  return (await loadNodeSqlite()) ? 'node:sqlite' : 'sql.js';
}

export async function openDatabase(
  file: string,
  opts: OpenDatabaseOptions = {},
): Promise<OpenedDatabase> {
  const driver = !opts.driver || opts.driver === 'auto' ? await detectDriver() : opts.driver;
  if (file !== MEMORY_DB) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = driver === 'node:sqlite' ? await openNodeSqlite(file) : await openSqlJs(file);
  const migration = opts.migrate === false ? null : migrate(db);
  return { db, migration };
}
