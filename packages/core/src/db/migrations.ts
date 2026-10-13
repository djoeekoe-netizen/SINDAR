import type { Db, FtsKind } from './types.js';

export interface Migration {
  id: number;
  name: string;
  up: (db: Db) => void;
}

/**
 * Schema v1 — sessions, messages (+FTS5), approvals, cron, pairings, usage.
 * `messages.seq` is an INTEGER PRIMARY KEY so the FTS external-content rowid is stable.
 */
const init: Migration = {
  id: 1,
  name: 'init',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        title       TEXT,
        channel     TEXT NOT NULL,
        user_id     TEXT,
        parent_id   TEXT,
        model       TEXT,
        cwd         TEXT,
        summary     TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_channel_user ON sessions(channel, user_id);

      CREATE TABLE IF NOT EXISTS messages (
        seq          INTEGER PRIMARY KEY AUTOINCREMENT,
        id           TEXT NOT NULL UNIQUE,
        session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role         TEXT NOT NULL,
        content      TEXT,
        tool_calls   TEXT,
        tool_call_id TEXT,
        name         TEXT,
        tokens_in    INTEGER,
        tokens_out   INTEGER,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);

      CREATE TABLE IF NOT EXISTS approvals (
        id          TEXT PRIMARY KEY,
        session_id  TEXT,
        tool        TEXT NOT NULL,
        args        TEXT,
        risk        TEXT,
        status      TEXT NOT NULL,
        decided_by  TEXT,
        created_at  INTEGER NOT NULL,
        decided_at  INTEGER
      );

      CREATE TABLE IF NOT EXISTS cron_jobs (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        schedule    TEXT NOT NULL,
        timezone    TEXT,
        prompt      TEXT NOT NULL,
        deliver_to  TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1,
        last_run    INTEGER,
        last_status TEXT,
        next_run    INTEGER,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pairings (
        channel      TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        display_name TEXT,
        code         TEXT,
        status       TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        PRIMARY KEY (channel, user_id)
      );

      CREATE TABLE IF NOT EXISTS usage (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT,
        provider    TEXT,
        model       TEXT,
        tokens_in   INTEGER NOT NULL DEFAULT 0,
        tokens_out  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage(created_at);

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    const fts = db.fts();
    if (fts === 'fts5') {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
          USING fts5(content, content='messages', content_rowid='seq');
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (new.seq, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.seq, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.seq, old.content);
          INSERT INTO messages_fts(rowid, content) VALUES (new.seq, new.content);
        END;
      `);
    } else if (fts === 'fts4') {
      // FTS4 external-content: deletions must read the old row, hence BEFORE triggers.
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
          USING fts4(content, content='messages');
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(docid, content) VALUES (new.seq, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_bd BEFORE DELETE ON messages BEGIN
          DELETE FROM messages_fts WHERE docid = old.seq;
        END;
        CREATE TRIGGER IF NOT EXISTS messages_bu BEFORE UPDATE OF content ON messages BEGIN
          DELETE FROM messages_fts WHERE docid = old.seq;
        END;
        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
          INSERT INTO messages_fts(docid, content) VALUES (new.seq, new.content);
        END;
      `);
    }
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['fts_kind', fts]);
  },
};

/** Which FTS engine the message index was created with (persisted in `meta`). */
export function ftsKind(db: Db): FtsKind {
  try {
    const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'fts_kind'");
    const v = row?.value;
    return v === 'fts5' || v === 'fts4' ? v : 'none';
  } catch {
    return 'none';
  }
}

export const MIGRATIONS: Migration[] = [init];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.id ?? 0;

export interface MigrateResult {
  applied: number[];
  current: number;
}

export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): MigrateResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
  const done = new Set(
    db.all<{ id: number }>('SELECT id FROM schema_migrations').map((r) => Number(r.id)),
  );
  const applied: number[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      m.up(db);
      db.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', [
        m.id,
        m.name,
        Date.now(),
      ]);
    });
    applied.push(m.id);
  }
  const row = db.get<{ v: number | null }>('SELECT MAX(id) AS v FROM schema_migrations');
  return { applied, current: Number(row?.v ?? 0) };
}

export function schemaVersion(db: Db): number {
  try {
    const row = db.get<{ v: number | null }>('SELECT MAX(id) AS v FROM schema_migrations');
    return Number(row?.v ?? 0);
  } catch {
    return 0;
  }
}
