import { randomUUID } from 'node:crypto';
import type { Db, SqlParam } from '../db/types.js';
import type { ChatMessage, Content, ToolCall, Usage } from '../providers/types.js';

export interface Session {
  id: string;
  title: string | null;
  channel: string;
  userId: string | null;
  parentId: string | null;
  model: string | null;
  cwd: string | null;
  summary: string | null;
  summaryUpto: number;
  approvalMode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage extends ChatMessage {
  seq: number;
  id: string;
  sessionId: string;
  createdAt: number;
}

export interface SessionSummaryRow extends Session {
  messageCount: number;
}

interface SessionRow {
  id: string;
  title: string | null;
  channel: string;
  user_id: string | null;
  parent_id: string | null;
  model: string | null;
  cwd: string | null;
  summary: string | null;
  summary_upto: number;
  approval_mode: string | null;
  created_at: number;
  updated_at: number;
  message_count?: number;
}
interface MessageRow {
  seq: number;
  id: string;
  session_id: string;
  role: string;
  content: string | null;
  parts: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  name: string | null;
  created_at: number;
}

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  title: r.title,
  channel: r.channel,
  userId: r.user_id,
  parentId: r.parent_id,
  model: r.model,
  cwd: r.cwd,
  summary: r.summary,
  summaryUpto: r.summary_upto ?? 0,
  approvalMode: r.approval_mode,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function contentToText(c: Content | null | undefined): string {
  if (!c) return '';
  if (typeof c === 'string') return c;
  return c.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n');
}

export function newId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 20);
}

export class SessionStore {
  constructor(private readonly db: Db) {}

  create(input: {
    channel: string;
    model?: string;
    cwd?: string;
    title?: string;
    userId?: string;
    parentId?: string;
    approvalMode?: string;
  }): Session {
    const now = Date.now();
    const id = newId();
    this.db.run(
      `INSERT INTO sessions (id, title, channel, user_id, parent_id, model, cwd, summary, summary_upto, approval_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)`,
      [
        id,
        input.title ?? null,
        input.channel,
        input.userId ?? null,
        input.parentId ?? null,
        input.model ?? null,
        input.cwd ?? null,
        input.approvalMode ?? null,
        now,
        now,
      ],
    );
    return this.get(id)!;
  }

  get(id: string): Session | undefined {
    const r = this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
    return r ? toSession(r) : undefined;
  }

  /** Prefix lookup so users can type the first few characters of an id. */
  find(idOrPrefix: string): Session | undefined {
    const exact = this.get(idOrPrefix);
    if (exact) return exact;
    const rows = this.db.all<SessionRow>(
      'SELECT * FROM sessions WHERE id LIKE ? ORDER BY updated_at DESC LIMIT 2',
      [`${idOrPrefix}%`],
    );
    return rows.length === 1 ? toSession(rows[0]!) : undefined;
  }

  last(channel?: string): Session | undefined {
    const r = channel
      ? this.db.get<SessionRow>(
          'SELECT * FROM sessions WHERE channel = ? ORDER BY updated_at DESC LIMIT 1',
          [channel],
        )
      : this.db.get<SessionRow>('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1');
    return r ? toSession(r) : undefined;
  }

  list(opts: { channel?: string; limit?: number } = {}): SessionSummaryRow[] {
    const limit = opts.limit ?? 20;
    const rows = opts.channel
      ? this.db.all<SessionRow>(
          `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
           FROM sessions s WHERE channel = ? ORDER BY updated_at DESC LIMIT ?`,
          [opts.channel, limit],
        )
      : this.db.all<SessionRow>(
          `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
           FROM sessions s ORDER BY updated_at DESC LIMIT ?`,
          [limit],
        );
    return rows.map((r) => ({ ...toSession(r), messageCount: r.message_count ?? 0 }));
  }

  update(
    id: string,
    patch: Partial<
      Pick<Session, 'title' | 'model' | 'cwd' | 'summary' | 'summaryUpto' | 'approvalMode'>
    >,
  ): void {
    const sets: string[] = [];
    const params: SqlParam[] = [];
    const map: Record<string, string> = {
      title: 'title',
      model: 'model',
      cwd: 'cwd',
      summary: 'summary',
      summaryUpto: 'summary_upto',
      approvalMode: 'approval_mode',
    };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${map[k]} = ?`);
      params.push(v as SqlParam);
    }
    sets.push('updated_at = ?');
    params.push(Date.now(), id);
    this.db.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  delete(id: string): void {
    this.db.run('DELETE FROM sessions WHERE id = ?', [id]);
  }

  append(sessionId: string, msg: ChatMessage): StoredMessage {
    const id = newId();
    const now = Date.now();
    const text = contentToText(msg.content);
    const parts = Array.isArray(msg.content) ? JSON.stringify(msg.content) : null;
    const r = this.db.run(
      `INSERT INTO messages (id, session_id, role, content, parts, tool_calls, tool_call_id, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sessionId,
        msg.role,
        text,
        parts,
        msg.toolCalls?.length ? JSON.stringify(msg.toolCalls) : null,
        msg.toolCallId ?? null,
        msg.name ?? null,
        now,
      ],
    );
    this.db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [now, sessionId]);
    return { ...msg, seq: Number(r.lastInsertRowid), id, sessionId, createdAt: now };
  }

  messages(sessionId: string, opts: { afterSeq?: number; limit?: number } = {}): StoredMessage[] {
    const rows = this.db.all<MessageRow>(
      `SELECT * FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq ASC${opts.limit ? ` LIMIT ${Number(opts.limit)}` : ''}`,
      [sessionId, opts.afterSeq ?? 0],
    );
    return rows.map((r) => ({
      seq: r.seq,
      id: r.id,
      sessionId: r.session_id,
      role: r.role as ChatMessage['role'],
      content: r.parts ? (JSON.parse(r.parts) as Content) : r.content,
      toolCalls: r.tool_calls ? (JSON.parse(r.tool_calls) as ToolCall[]) : undefined,
      toolCallId: r.tool_call_id ?? undefined,
      name: r.name ?? undefined,
      createdAt: r.created_at,
    }));
  }

  count(sessionId: string): number {
    return (
      this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?', [
        sessionId,
      ])?.n ?? 0
    );
  }

  /** Remove the last user turn (user message + everything after it). Returns the removed user text. */
  undoLastTurn(sessionId: string): string | undefined {
    const last = this.db.get<{ seq: number; content: string | null }>(
      "SELECT seq, content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY seq DESC LIMIT 1",
      [sessionId],
    );
    if (!last) return undefined;
    this.db.run('DELETE FROM messages WHERE session_id = ? AND seq >= ?', [sessionId, last.seq]);
    const s = this.get(sessionId);
    if (s && s.summaryUpto >= last.seq) this.update(sessionId, { summary: null, summaryUpto: 0 });
    return last.content ?? '';
  }

  recordUsage(sessionId: string, provider: string, model: string, usage: Usage): void {
    this.db.run(
      'INSERT INTO usage (session_id, provider, model, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, provider, model, usage.inputTokens, usage.outputTokens, Date.now()],
    );
  }

  usage(sessionId?: string): Array<{
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    calls: number;
  }> {
    const rows = sessionId
      ? this.db.all<{
          provider: string;
          model: string;
          tokens_in: number;
          tokens_out: number;
          calls: number;
        }>(
          'SELECT provider, model, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, COUNT(*) AS calls FROM usage WHERE session_id = ? GROUP BY provider, model',
          [sessionId],
        )
      : this.db.all<{
          provider: string;
          model: string;
          tokens_in: number;
          tokens_out: number;
          calls: number;
        }>(
          'SELECT provider, model, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, COUNT(*) AS calls FROM usage GROUP BY provider, model',
        );
    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      tokensIn: r.tokens_in ?? 0,
      tokensOut: r.tokens_out ?? 0,
      calls: r.calls,
    }));
  }

  recordApproval(input: {
    sessionId?: string;
    tool: string;
    args: unknown;
    risk: string;
    status: 'allowed' | 'denied' | 'auto' | 'forbidden';
    decidedBy: string;
  }): void {
    const now = Date.now();
    this.db.run(
      'INSERT INTO approvals (id, session_id, tool, args, risk, status, decided_by, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newId(),
        input.sessionId ?? null,
        input.tool,
        JSON.stringify(input.args).slice(0, 4000),
        input.risk,
        input.status,
        input.decidedBy,
        now,
        now,
      ],
    );
  }
}
