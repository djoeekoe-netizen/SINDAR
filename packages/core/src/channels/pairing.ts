import { randomInt } from 'node:crypto';
import type { Db } from '../db/types.js';

export type PairingStatus = 'pending' | 'approved' | 'revoked';

export interface Pairing {
  channel: string;
  /** Chat/user id on that channel (string — Telegram ids are numbers, others may not be). */
  userId: string;
  displayName: string | null;
  /** Pairing code while pending (6 digits). */
  code: string | null;
  status: PairingStatus;
  createdAt: number;
}

interface Row {
  channel: string;
  user_id: string;
  display_name: string | null;
  code: string | null;
  status: string;
  created_at: number;
}

const toPairing = (r: Row): Pairing => ({
  channel: r.channel,
  userId: r.user_id,
  displayName: r.display_name,
  code: r.code,
  status: r.status as PairingStatus,
  createdAt: Number(r.created_at),
});

/** Pending codes older than this get a fresh code on the next request. */
export const PAIRING_CODE_TTL_MS = 60 * 60_000;

/**
 * Who may talk to SINDAR over a channel (Telegram, …). Unknown chats receive a 6-digit code;
 * the owner approves it from the gateway host (CLI or web UI) — proof of ownership.
 */
export class PairingStore {
  constructor(private readonly db: Db) {}

  /** Register (or refresh) a pending request; returns the row with its current code. */
  request(channel: string, userId: string, displayName?: string | null): Pairing {
    const now = Date.now();
    const existing = this.get(channel, userId);
    if (existing?.status === 'approved') return existing;
    const fresh =
      existing?.status === 'pending' &&
      existing.code &&
      now - existing.createdAt < PAIRING_CODE_TTL_MS;
    const code = fresh ? existing.code! : this.newCode(channel);
    this.db.run(
      `INSERT INTO pairings (channel, user_id, display_name, code, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)
       ON CONFLICT(channel, user_id) DO UPDATE SET
         display_name = excluded.display_name, code = excluded.code,
         status = 'pending', created_at = excluded.created_at`,
      [
        channel,
        userId,
        displayName ?? existing?.displayName ?? null,
        code,
        fresh ? existing.createdAt : now,
      ],
    );
    return this.get(channel, userId)!;
  }

  /** Approve by code (what the owner types). */
  approve(channel: string, code: string): Pairing | undefined {
    const clean = code.replace(/\D/g, '');
    if (!clean) return undefined;
    const row = this.db.get<Row>(
      `SELECT * FROM pairings WHERE channel = ? AND code = ? AND status = 'pending'`,
      [channel, clean],
    );
    if (!row) return undefined;
    if (Date.now() - Number(row.created_at) > PAIRING_CODE_TTL_MS) return undefined;
    return this.approveUser(channel, row.user_id, row.display_name);
  }

  /** Approve a chat directly (owner knows the id). */
  approveUser(channel: string, userId: string, displayName?: string | null): Pairing {
    this.db.run(
      `INSERT INTO pairings (channel, user_id, display_name, code, status, created_at)
       VALUES (?, ?, ?, NULL, 'approved', ?)
       ON CONFLICT(channel, user_id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, pairings.display_name),
         code = NULL, status = 'approved', created_at = excluded.created_at`,
      [channel, userId, displayName ?? null, Date.now()],
    );
    return this.get(channel, userId)!;
  }

  revoke(channel: string, userId: string): boolean {
    const r = this.db.run(
      `UPDATE pairings SET status = 'revoked', code = NULL WHERE channel = ? AND user_id = ? AND status <> 'revoked'`,
      [channel, userId],
    );
    return r.changes > 0;
  }

  isApproved(channel: string, userId: string): boolean {
    return this.get(channel, userId)?.status === 'approved';
  }

  get(channel: string, userId: string): Pairing | undefined {
    const r = this.db.get<Row>('SELECT * FROM pairings WHERE channel = ? AND user_id = ?', [
      channel,
      userId,
    ]);
    return r ? toPairing(r) : undefined;
  }

  list(channel: string, status?: PairingStatus): Pairing[] {
    const rows = status
      ? this.db.all<Row>(
          'SELECT * FROM pairings WHERE channel = ? AND status = ? ORDER BY created_at DESC',
          [channel, status],
        )
      : this.db.all<Row>('SELECT * FROM pairings WHERE channel = ? ORDER BY created_at DESC', [
          channel,
        ]);
    const now = Date.now();
    return rows
      .map(toPairing)
      .filter((p) => p.status !== 'pending' || now - p.createdAt < PAIRING_CODE_TTL_MS);
  }

  pending(channel: string): Pairing[] {
    return this.list(channel, 'pending');
  }

  private newCode(channel: string): string {
    for (let i = 0; i < 20; i++) {
      const code = String(randomInt(100_000, 1_000_000));
      const clash = this.db.get<Row>(
        `SELECT user_id FROM pairings WHERE channel = ? AND code = ? AND status = 'pending'`,
        [channel, code],
      );
      if (!clash) return code;
    }
    return String(randomInt(100_000, 1_000_000));
  }
}
