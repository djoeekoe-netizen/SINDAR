import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, detectDriver } from '../src/db/open.js';
import { ftsKind, LATEST_SCHEMA_VERSION, migrate, schemaVersion } from '../src/db/migrations.js';
import { loadNodeSqlite } from '../src/db/node-sqlite.js';
import { normalizeParams, type DbDriver } from '../src/db/types.js';

const drivers: DbDriver[] = ['sql.js'];
if (await loadNodeSqlite()) drivers.unshift('node:sqlite');

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-db-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('normalizeParams', () => {
  it('converts booleans and prefixes bare named params', () => {
    expect(normalizeParams([true, false, 'a'])).toEqual([1, 0, 'a']);
    expect(normalizeParams({ id: 1, $x: 'y', flag: true })).toEqual({ $id: 1, $x: 'y', $flag: 1 });
    expect(normalizeParams(undefined)).toBeUndefined();
  });
});

describe('detectDriver', () => {
  it('prefers node:sqlite when present', async () => {
    const d = await detectDriver();
    expect(drivers).toContain(d);
    expect(d).toBe(drivers[0]);
  });
});

describe.each(drivers)('driver %s', (driver) => {
  it('migrates to the latest schema idempotently', async () => {
    const file = path.join(dir, 'a.db');
    const { db, migration } = await openDatabase(file, { driver });
    expect(migration?.applied).toEqual([1, 2]);
    expect(migration?.current).toBe(LATEST_SCHEMA_VERSION);
    expect(schemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(migrate(db).applied).toEqual([]);
    const tables = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map((r) => r.name);
    for (const t of ['sessions', 'messages', 'approvals', 'cron_jobs', 'pairings', 'usage', 'meta'])
      expect(tables).toContain(t);
    await db.close();
  });

  it('supports CRUD with positional and named params, transactions and rollback', async () => {
    const { db } = await openDatabase(path.join(dir, 'b.db'), { driver });
    const now = Date.now();
    db.run(
      'INSERT INTO sessions (id, channel, created_at, updated_at) VALUES ($id, $channel, $now, $now)',
      { id: 's1', channel: 'cli', now },
    );
    const r = db.run(
      'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      ['m1', 's1', 'user', 'hello world', now],
    );
    expect(r.changes).toBe(1);
    expect(Number(r.lastInsertRowid)).toBeGreaterThan(0);
    expect(
      db.get<{ content: string }>('SELECT content FROM messages WHERE id = ?', ['m1'])?.content,
    ).toBe('hello world');

    expect(() =>
      db.transaction(() => {
        db.run(
          'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
          ['m2', 's1', 'user', 'x', now],
        );
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.all('SELECT id FROM messages')).toHaveLength(1);

    // foreign keys: cascade delete
    db.run('DELETE FROM sessions WHERE id = ?', ['s1']);
    expect(db.all('SELECT id FROM messages')).toHaveLength(0);
    await db.close();
  });

  it('indexes messages for full-text search and keeps the index in sync', async () => {
    const { db } = await openDatabase(path.join(dir, 'c.db'), { driver });
    const kind = ftsKind(db);
    expect(kind).not.toBe('none');
    expect(kind).toBe(db.fts());
    const now = Date.now();
    db.run("INSERT INTO sessions (id, channel, created_at, updated_at) VALUES ('s', 'web', ?, ?)", [
      now,
      now,
    ]);
    const ins = (id: string, content: string) =>
      db.run(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, 's', 'user', ?, ?)",
        [id, content, now],
      );
    ins('m1', 'SINDAR remembers my favourite tea is karak');
    ins('m2', 'the weather in Riyadh is hot');
    ins('m3', 'ذاكرة طويلة الأمد للوكيل');

    const search = (q: string) =>
      db
        .all<{ id: string }>(
          `SELECT m.id FROM messages_fts f JOIN messages m ON m.seq = f.rowid WHERE messages_fts MATCH ?`,
          [q],
        )
        .map((r) => r.id);
    expect(search('karak')).toEqual(['m1']);
    expect(search('riyadh')).toEqual(['m2']);
    expect(search('ذاكرة')).toEqual(['m3']);

    db.run("UPDATE messages SET content = 'now I prefer coffee' WHERE id = 'm1'");
    expect(search('karak')).toEqual([]);
    expect(search('coffee')).toEqual(['m1']);
    db.run("DELETE FROM messages WHERE id = 'm2'");
    expect(search('riyadh')).toEqual([]);
    await db.close();
  });

  it('persists across reopen', async () => {
    const file = path.join(dir, 'd.db');
    const a = await openDatabase(file, { driver });
    a.db.run(
      "INSERT INTO sessions (id, channel, created_at, updated_at) VALUES ('p', 'cli', 1, 1)",
    );
    await a.db.close();
    const b = await openDatabase(file, { driver });
    expect(b.db.get<{ id: string }>("SELECT id FROM sessions WHERE id = 'p'")?.id).toBe('p');
    expect(b.migration?.applied).toEqual([]);
    await b.db.close();
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
