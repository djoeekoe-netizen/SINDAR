import { randomUUID } from 'node:crypto';
import {
  AgentError,
  createPolicyState,
  runTurn,
  type AgentEvent,
  type AgentRuntime,
  type ApprovalMode,
  type ApprovalRequest,
  type PolicyState,
  type Session,
  type SessionSummaryRow,
  type StoredMessage,
} from '@sindar/core';
import type {
  ApprovalAnswer,
  ApprovalDTO,
  EventDTO,
  MessageDTO,
  ServerMessage,
  SessionDTO,
  UsageDTO,
} from './protocol.js';

const TOOL_OUTPUT_LIMIT = 12_000;
const APPROVAL_TIMEOUT_MS = 15 * 60_000;

export interface RunningTurn {
  sessionId: string;
  turnId: string;
  controller: AbortController;
  startedAt: number;
}

interface PendingApproval {
  dto: ApprovalDTO;
  resolve: (answer: ApprovalAnswer) => void;
  timer: NodeJS.Timeout;
}

export interface SendInput {
  sessionId?: string;
  text: string;
  model?: string;
  cwd?: string;
  clientRef?: string;
  channel?: string;
}

export type Listener = (msg: ServerMessage) => void;

function textOf(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p: { type?: string; text?: string }) => (p?.type === 'text' ? (p.text ?? '') : ''))
      .join('');
  }
  return String(content);
}

export function toSessionDTO(s: Session | SessionSummaryRow, running = false): SessionDTO {
  const row = s as SessionSummaryRow;
  return {
    id: s.id,
    title: s.title,
    channel: s.channel,
    model: s.model,
    cwd: s.cwd,
    approvalMode: s.approvalMode,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: row.messageCount,
    lastMessage: row.lastMessage ?? null,
    running,
  };
}

export function toMessageDTO(m: StoredMessage): MessageDTO {
  return {
    seq: m.seq,
    id: m.id,
    role: m.role,
    text: textOf(m.content),
    name: m.name,
    toolCalls: m.toolCalls?.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })),
    toolCallId: m.toolCallId,
    createdAt: m.createdAt,
  };
}

function prettyArgs(args: unknown): string {
  let s: string;
  try {
    s = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
  } catch {
    s = String(args);
  }
  return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
}

export function serializeEvent(ev: AgentEvent): EventDTO | undefined {
  switch (ev.type) {
    case 'text':
    case 'reasoning':
      return { type: ev.type, delta: ev.delta };
    case 'tool_start':
      return {
        type: 'tool_start',
        call: { id: ev.call.id, name: ev.call.name, arguments: ev.call.arguments },
        summary: ev.summary,
        risk: ev.decision.detail.risk,
        reason: ev.decision.reason,
      };
    case 'tool_progress':
      return { type: 'tool_progress', callId: ev.call.id, line: ev.line };
    case 'tool_end': {
      const truncated = ev.result.content.length > TOOL_OUTPUT_LIMIT;
      return {
        type: 'tool_end',
        callId: ev.call.id,
        name: ev.call.name,
        content: truncated
          ? `${ev.result.content.slice(0, TOOL_OUTPUT_LIMIT)}…`
          : ev.result.content,
        isError: Boolean(ev.result.isError),
        ms: ev.ms,
        truncated,
      };
    }
    case 'tool_denied':
      return {
        type: 'tool_denied',
        call: { id: ev.call.id, name: ev.call.name, arguments: ev.call.arguments },
        summary: ev.summary,
        reason: ev.reason,
      };
    case 'usage':
      return { type: 'usage', usage: ev.usage, model: ev.model };
    case 'model_switch':
      return { type: 'model_switch', from: ev.from, to: ev.to, reason: ev.reason };
    case 'compress':
      return { type: 'compress', beforeTokens: ev.beforeTokens, afterTokens: ev.afterTokens };
    case 'notice':
      return { type: 'notice', message: ev.message };
    case 'skill_saved':
      return { type: 'skill_saved', name: ev.name, action: ev.action };
    case 'retry_wait':
      return {
        type: 'retry_wait',
        model: ev.model,
        seconds: ev.seconds,
        attempt: ev.attempt,
        reason: ev.reason,
      };
    case 'done':
      return {
        type: 'done',
        finishReason: ev.finishReason,
        text: ev.text,
        iterations: ev.iterations,
      };
    case 'error':
      return {
        type: 'error',
        message: ev.error.message,
        code: (ev.error as { code?: string }).code,
      };
    default:
      return undefined;
  }
}

/**
 * Runs agent turns for the gateway: one turn per session at a time, approvals that
 * outlive a single socket, and a broadcast stream every connected client can render.
 */
export class TurnManager {
  private readonly policies = new Map<string, PolicyState>();
  private readonly running = new Map<string, RunningTurn>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly rt: AgentRuntime) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(msg: ServerMessage): void {
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch (err) {
        this.rt.logger.warn('listener failed', { error: (err as Error).message });
      }
    }
  }

  policyFor(session: Session): PolicyState {
    let p = this.policies.get(session.id);
    if (!p) {
      const mode =
        (session.approvalMode as ApprovalMode | null) ?? this.rt.config.agent.approvalMode;
      p = createPolicyState(mode, this.rt.config.agent.allowlist);
      this.policies.set(session.id, p);
    }
    return p;
  }

  /** Approval mode changes apply to new policies; existing session policies follow too. */
  setApprovalMode(mode: ApprovalMode): void {
    for (const p of this.policies.values()) p.mode = mode;
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  /** Session DTO with message count + last-message preview (what the sidebar shows). */
  summary(session: Session, running = this.isRunning(session.id)): SessionDTO {
    return toSessionDTO(this.rt.store.summary(session.id) ?? session, running);
  }

  runningSessions(): string[] {
    return [...this.running.keys()];
  }

  pendingApprovals(): ApprovalDTO[] {
    return [...this.approvals.values()].map((p) => p.dto);
  }

  createSession(input: { model?: string; cwd?: string; channel?: string } = {}): Session {
    const session = this.rt.store.create({
      channel: input.channel ?? 'web',
      cwd: input.cwd ?? this.rt.paths.workspace,
      model: input.model,
    });
    this.broadcast({ type: 'session', action: 'created', session: this.summary(session) });
    return session;
  }

  deleteSession(id: string): boolean {
    const s = this.rt.store.get(id);
    if (!s) return false;
    this.cancel(id);
    this.rt.store.delete(id);
    this.policies.delete(id);
    this.broadcast({ type: 'session', action: 'deleted', session: toSessionDTO(s) });
    return true;
  }

  updateSession(
    id: string,
    patch: { model?: string | null; title?: string; cwd?: string },
  ): Session | undefined {
    const s = this.rt.store.get(id);
    if (!s) return undefined;
    this.rt.store.update(id, patch);
    const updated = this.rt.store.get(id)!;
    this.broadcast({
      type: 'session',
      action: 'updated',
      session: this.summary(updated, this.isRunning(id)),
    });
    return updated;
  }

  /**
   * Start a turn. Resolves as soon as the turn is accepted (events stream to listeners);
   * the returned promise `done` settles when the turn finishes.
   */
  send(input: SendInput): { session: Session; turnId: string; done: Promise<void> } {
    const text = input.text.trim();
    if (!text) throw new Error('empty message');
    let session = input.sessionId ? this.rt.store.get(input.sessionId) : undefined;
    if (input.sessionId && !session) throw new Error(`unknown session ${input.sessionId}`);
    if (!session)
      session = this.createSession({ model: input.model, cwd: input.cwd, channel: input.channel });
    if (this.running.has(session.id)) throw new Error('a turn is already running for this session');
    if (input.model && input.model !== session.model) {
      this.rt.store.update(session.id, { model: input.model });
      session = this.rt.store.get(session.id)!;
    }

    const turnId = randomUUID().slice(0, 8);
    const controller = new AbortController();
    const sessionId = session.id;
    const run: RunningTurn = { sessionId, turnId, controller, startedAt: Date.now() };
    this.running.set(sessionId, run);
    const policy = this.policyFor(session);
    const modelRef = input.model ?? session.model ?? this.rt.config.model.default;
    this.broadcast({
      type: 'turn_start',
      sessionId,
      turnId,
      session: this.summary(session, true),
      model: modelRef,
      clientRef: input.clientRef,
      text,
    });

    const done = (async () => {
      let usage: UsageDTO = { inputTokens: 0, outputTokens: 0 };
      let seq = 0;
      try {
        const result = await runTurn(this.rt, {
          session: session!,
          input: text,
          modelRef: input.model,
          policy,
          cwd: session!.cwd ?? this.rt.paths.workspace,
          signal: controller.signal,
          onEvent: (ev) => {
            if (ev.type === 'usage') {
              usage = {
                inputTokens: usage.inputTokens + ev.usage.inputTokens,
                outputTokens: usage.outputTokens + ev.usage.outputTokens,
              };
            }
            const dto = serializeEvent(ev);
            if (dto) this.broadcast({ type: 'event', sessionId, turnId, seq: ++seq, event: dto });
          },
          requestApproval: (req) => this.requestApproval(sessionId, turnId, req),
        });
        this.broadcast({
          type: 'turn_end',
          sessionId,
          turnId,
          ok: true,
          finishReason: result.finishReason,
          text: result.text,
          usage,
        });
      } catch (err) {
        const e = err as Error & { cause?: { code?: string } };
        const code = e instanceof AgentError ? e.cause?.code : (e as { code?: string }).code;
        this.rt.logger.warn('turn failed', { sessionId, error: e.message });
        this.broadcast({
          type: 'turn_end',
          sessionId,
          turnId,
          ok: false,
          error: { message: e.message, code },
          usage,
        });
      } finally {
        this.running.delete(sessionId);
        // Drop approvals that belong to this turn (a cancelled turn must not leave zombies).
        for (const [id, p] of this.approvals) {
          if (p.dto.turnId === turnId) {
            clearTimeout(p.timer);
            this.approvals.delete(id);
            this.broadcast({ type: 'approval_resolved', id, answer: 'deny' });
          }
        }
        const fresh = this.rt.store.get(sessionId);
        if (fresh)
          this.broadcast({
            type: 'session',
            action: 'updated',
            session: this.summary(fresh, false),
          });
      }
    })();

    return { session, turnId, done };
  }

  cancel(sessionId: string): boolean {
    const run = this.running.get(sessionId);
    if (!run) return false;
    run.controller.abort();
    // Any approval waiting on this turn is answered "deny" so the loop can unwind.
    for (const p of this.approvals.values()) {
      if (p.dto.turnId === run.turnId) p.resolve('deny');
    }
    return true;
  }

  answer(id: string, answer: ApprovalAnswer): boolean {
    const p = this.approvals.get(id);
    if (!p) return false;
    p.resolve(answer);
    return true;
  }

  private requestApproval(
    sessionId: string,
    turnId: string,
    req: ApprovalRequest,
  ): Promise<ApprovalAnswer> {
    const id = randomUUID().slice(0, 12);
    const dto: ApprovalDTO = {
      id,
      sessionId,
      turnId,
      tool: req.tool.name,
      summary: req.decision.summary,
      risk: req.decision.detail.risk,
      reason: req.decision.reason,
      args: prettyArgs(req.args),
      createdAt: Date.now(),
    };
    return new Promise<ApprovalAnswer>((resolve) => {
      const finish = (answer: ApprovalAnswer) => {
        const pending = this.approvals.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.approvals.delete(id);
        pending.dto.answer = answer;
        this.broadcast({ type: 'approval_resolved', id, answer });
        resolve(answer);
      };
      const timer = setTimeout(() => finish('deny'), APPROVAL_TIMEOUT_MS);
      timer.unref?.();
      this.approvals.set(id, { dto, resolve: finish, timer });
      this.broadcast({ type: 'approval', approval: dto });
    });
  }

  /** Abort everything (gateway shutdown). */
  async shutdown(): Promise<void> {
    const ids = Array.from(this.running.keys());
    for (const id of ids) this.cancel(id);
    if (ids.length > 0) await new Promise((r) => setTimeout(r, 50));
  }
}
