import fs from 'node:fs';
import {
  BUILD,
  VERSION,
  t,
  type AgentRuntime,
  type MessageKey,
  type PairingStore,
} from '@sindar/core';
import type { ApprovalAnswer, ApprovalDTO, FileRefDTO, ServerMessage } from '../../protocol.js';
import type { TurnManager } from '../../runner.js';
import {
  TelegramApi,
  TelegramError,
  type TgCallbackQuery,
  type TgChat,
  type TgMessage,
  type TgUpdate,
  type TgUser,
} from './api.js';
import { chunkHtml, escapeHtml, htmlToText, markdownToTelegramHtml } from './format.js';

export const TELEGRAM_CHANNEL = 'telegram';
/** Bot API upload limit. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** While streaming, show at most this much (final message is chunked properly). */
const STREAM_PREVIEW_CHARS = 3500;
const PAIRING_HINT_EVERY_MS = 60_000;

export interface TelegramChannelOptions {
  token: string;
  fetch?: typeof fetch;
  apiBase?: string;
  /** Long-poll wait (seconds). Default 30. */
  pollTimeoutS?: number;
  /** Minimum gap between edits of the streaming reply (ms). Default 1500. */
  streamIntervalMs?: number;
  /** "typing…" refresh (ms). Default 4000. */
  typingIntervalMs?: number;
}

export interface TelegramStatus {
  running: boolean;
  bot?: { id: number; username: string; name: string };
  startedAt?: number;
  lastUpdateAt?: number;
  lastError?: string;
  updates: number;
}

interface ActiveTurn {
  turnId: string;
  sessionId: string;
  chatId: number;
  text: string;
  toolLine?: string;
  /** Transient status (waiting for a rate limit, model switched…) shown until text arrives. */
  statusLine?: string;
  messageId?: number;
  shown: string;
  lastEditAt: number;
  flushTimer?: NodeJS.Timeout;
  typingTimer?: NodeJS.Timeout;
  files: FileRefDTO[];
  editPausedUntil: number;
  finished: boolean;
  /** A send/edit in progress — `finish()` waits for it so no placeholder is left behind. */
  inflight?: Promise<void>;
}

interface ChatState {
  chatId: number;
  sessionId?: string;
  turn?: ActiveTurn;
  lastPairingHintAt?: number;
}

interface ApprovalMsg {
  chatId: number;
  messageId: number;
  summary: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function displayName(from: TgUser | undefined, chat: TgChat): string {
  if (chat.type !== 'private') return chat.title ?? `group ${chat.id}`;
  const name = [from?.first_name ?? chat.first_name, from?.last_name ?? chat.last_name]
    .filter(Boolean)
    .join(' ');
  const user = from?.username ?? chat.username;
  return user ? `${name || user} (@${user})` : name || String(chat.id);
}

/**
 * Telegram as a channel: long polling → TurnManager turns → streamed replies, inline-keyboard
 * approvals and document delivery. Unknown chats get a pairing code (approved from the host).
 */
export class TelegramChannel {
  readonly api: TelegramApi;
  readonly pairings: PairingStore;
  private readonly chats = new Map<number, ChatState>();
  private readonly turns = new Map<string, ActiveTurn>();
  private readonly approvalMsgs = new Map<string, ApprovalMsg>();
  private readonly pollTimeoutS: number;
  private readonly streamIntervalMs: number;
  private readonly typingIntervalMs: number;
  private bot?: TgUser;
  private abort = new AbortController();
  private unsubscribe?: () => void;
  private pollPromise?: Promise<void>;
  private readonly state: TelegramStatus = { running: false, updates: 0 };

  constructor(
    private readonly rt: AgentRuntime,
    private readonly manager: TurnManager,
    pairings: PairingStore,
    private readonly opts: TelegramChannelOptions,
  ) {
    this.api = new TelegramApi(opts.token, { fetch: opts.fetch, apiBase: opts.apiBase });
    this.pairings = pairings;
    this.pollTimeoutS = opts.pollTimeoutS ?? 30;
    this.streamIntervalMs = opts.streamIntervalMs ?? 1500;
    this.typingIntervalMs = opts.typingIntervalMs ?? 4000;
  }

  private get cfg() {
    return this.rt.config.channels.telegram;
  }

  private tr(key: MessageKey, vars?: Record<string, string | number | undefined>): string {
    return t(this.rt.lang, key, vars);
  }

  status(): TelegramStatus {
    return { ...this.state };
  }

  /** Validate the token, register commands and start polling. Throws when the token is bad. */
  async start(): Promise<TgUser> {
    if (this.state.running) return this.bot!;
    this.abort = new AbortController();
    const me = await this.api.getMe(this.abort.signal);
    this.bot = me;
    this.state.bot = { id: me.id, username: me.username ?? '', name: me.first_name };
    this.state.lastError = undefined;
    await this.api.deleteWebhook().catch(() => false);
    await this.registerCommands().catch((err: Error) =>
      this.rt.logger.warn('telegram: setMyCommands failed', { error: err.message }),
    );
    this.state.running = true;
    this.state.startedAt = Date.now();
    this.unsubscribe = this.manager.subscribe((m) => this.onServerMessage(m));
    this.pollPromise = this.pollLoop();
    this.rt.logger.info('telegram: polling', { bot: me.username });
    return me;
  }

  async stop(): Promise<void> {
    if (!this.state.running) return;
    this.state.running = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.abort.abort();
    for (const turn of this.turns.values()) this.clearTimers(turn);
    await this.pollPromise?.catch(() => undefined);
    this.pollPromise = undefined;
    this.rt.logger.info('telegram: stopped');
  }

  private async registerCommands(): Promise<void> {
    const cmds = (['new', 'stop', 'status', 'model', 'help'] as const).map((c) => ({
      command: c,
      description: this.tr(`tg.cmd.${c}` as MessageKey),
    }));
    await this.api.setMyCommands(cmds);
  }

  // ---- access ---------------------------------------------------------------

  isAllowed(chatId: number): boolean {
    return (
      this.cfg.allowFrom.includes(chatId) ||
      this.pairings.isApproved(TELEGRAM_CHANNEL, String(chatId))
    );
  }

  /** Called by the gateway after an approval from the CLI/web UI. */
  async notifyPaired(chatId: number): Promise<void> {
    await this.send(chatId, this.tr('tg.paired')).catch(() => undefined);
  }

  async notifyRevoked(chatId: number): Promise<void> {
    await this.send(chatId, this.tr('tg.revoked')).catch(() => undefined);
  }

  // ---- polling --------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    let offset = 0;
    let backoff = 1000;
    while (this.state.running) {
      try {
        const updates = await this.api.getUpdates(
          {
            offset,
            timeout: this.pollTimeoutS,
            allowed_updates: ['message', 'callback_query'],
          },
          this.abort.signal,
        );
        backoff = 1000;
        for (const u of updates) {
          offset = Math.max(offset, u.update_id + 1);
          this.state.updates++;
          this.state.lastUpdateAt = Date.now();
          try {
            await this.handleUpdate(u);
          } catch (err) {
            this.rt.logger.warn('telegram: update failed', { error: (err as Error).message });
          }
        }
      } catch (err) {
        if (!this.state.running) break;
        const e = err as TelegramError;
        this.state.lastError = e.message;
        if (e.code === 409) {
          // Another process is polling with this token (old gateway still alive?).
          this.rt.logger.warn('telegram: another bot instance is polling (409) — retrying');
          await sleep(5000);
          continue;
        }
        if (e.code === 401) {
          this.rt.logger.error('telegram: token rejected (401) — stopping');
          this.state.running = false;
          break;
        }
        this.rt.logger.warn('telegram: poll error', { error: e.message, backoffMs: backoff });
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  async handleUpdate(u: TgUpdate): Promise<void> {
    if (u.message) await this.handleMessage(u.message);
    else if (u.callback_query) await this.handleCallback(u.callback_query);
  }

  // ---- messages -------------------------------------------------------------

  private async handleMessage(msg: TgMessage): Promise<void> {
    const from = msg.from;
    if (!from || from.is_bot) return;
    const chat = msg.chat;
    const chatId = chat.id;
    const isPrivate = chat.type === 'private';
    let text = (msg.text ?? msg.caption ?? '').trim();
    const cmd = this.parseCommand(text);
    if (cmd?.foreign) return; // /cmd@otherbot

    if (!this.isAllowed(chatId)) {
      // Private chats always get the pairing hint; groups only when someone asks the bot.
      if (!isPrivate && !cmd && !this.mentioned(msg)) return;
      const state = this.chat(chatId);
      const now = Date.now();
      if (state.lastPairingHintAt && now - state.lastPairingHintAt < PAIRING_HINT_EVERY_MS) return;
      state.lastPairingHintAt = now;
      const p = this.pairings.request(TELEGRAM_CHANNEL, String(chatId), displayName(from, chat));
      this.rt.logger.info('telegram: pairing requested', { chatId, name: p.displayName });
      await this.send(chatId, this.tr('tg.pairing', { code: p.code ?? '' }));
      return;
    }

    if (!isPrivate) {
      const mode = this.cfg.groups;
      if (mode === 'off') return;
      if (mode === 'mention' && !cmd && !this.mentioned(msg)) return;
      text = this.stripMention(text);
    }

    if (cmd) {
      await this.handleCommand(chatId, cmd.name, cmd.args, from, chat);
      return;
    }
    if (!text) {
      await this.send(chatId, this.tr('tg.text_only'));
      return;
    }
    await this.runTurn(chatId, text);
  }

  private parseCommand(text: string): { name: string; args: string; foreign: boolean } | undefined {
    const m = /^\/([a-zA-Z0-9_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(text);
    if (!m) return undefined;
    const target = m[2];
    const foreign = Boolean(target && this.bot?.username && target !== this.bot.username);
    return { name: m[1]!.toLowerCase(), args: (m[3] ?? '').trim(), foreign };
  }

  private mentioned(msg: TgMessage): boolean {
    const user = this.bot?.username;
    if (msg.reply_to_message?.from?.id === this.bot?.id) return true;
    if (!user) return false;
    return (msg.text ?? msg.caption ?? '').includes(`@${user}`);
  }

  private stripMention(text: string): string {
    const user = this.bot?.username;
    return user ? text.replace(new RegExp(`@${user}\\b`, 'g'), '').trim() : text;
  }

  private async handleCommand(
    chatId: number,
    name: string,
    args: string,
    from: TgUser,
    chat: TgChat,
  ): Promise<void> {
    const state = this.chat(chatId);
    switch (name) {
      case 'start': {
        await this.send(
          chatId,
          this.tr('tg.welcome', { name: from.first_name || chat.title || '' }),
        );
        if (args) await this.runTurn(chatId, args);
        return;
      }
      case 'help':
        await this.send(chatId, this.tr('tg.help'));
        return;
      case 'new': {
        if (state.turn) this.manager.cancel(state.turn.sessionId);
        const session = this.manager.createSession({
          channel: TELEGRAM_CHANNEL,
          userId: String(chatId),
        });
        state.sessionId = session.id;
        await this.send(chatId, this.tr('tg.new'));
        if (args) await this.runTurn(chatId, args);
        return;
      }
      case 'stop': {
        const sessionId = state.turn?.sessionId ?? state.sessionId;
        const stopped = sessionId ? this.manager.cancel(sessionId) : false;
        await this.send(chatId, this.tr(stopped ? 'tg.stopped' : 'tg.nothing_running'));
        return;
      }
      case 'status': {
        const session = this.currentSession(chatId);
        const running = session ? this.manager.isRunning(session.id) : false;
        await this.send(
          chatId,
          this.tr('tg.status', {
            model: session?.model ?? this.rt.config.model.default,
            session: session?.title ?? session?.id ?? '—',
            messages: session ? this.rt.store.count(session.id) : 0,
            state: this.tr(running ? 'tg.status.running' : 'tg.status.idle'),
            version: `${VERSION} (${BUILD.slice(0, 7)})`,
          }),
        );
        return;
      }
      case 'model': {
        const session = this.currentSession(chatId);
        await this.send(
          chatId,
          this.tr('tg.model', { model: session?.model ?? this.rt.config.model.default }),
        );
        return;
      }
      default:
        await this.send(chatId, this.tr('tg.help'));
    }
  }

  private chat(chatId: number): ChatState {
    let s = this.chats.get(chatId);
    if (!s) {
      s = { chatId };
      this.chats.set(chatId, s);
    }
    return s;
  }

  private currentSession(chatId: number) {
    const state = this.chat(chatId);
    const byId = state.sessionId ? this.rt.store.get(state.sessionId) : undefined;
    if (byId) return byId;
    const last = this.rt.store.last(TELEGRAM_CHANNEL, String(chatId));
    if (last) state.sessionId = last.id;
    return last;
  }

  // ---- turns ----------------------------------------------------------------

  async runTurn(chatId: number, text: string): Promise<void> {
    const state = this.chat(chatId);
    const session = this.currentSession(chatId);
    if (state.turn || (session && this.manager.isRunning(session.id))) {
      await this.send(chatId, this.tr('tg.busy'));
      return;
    }
    let started: ReturnType<TurnManager['send']>;
    try {
      started = this.manager.send({
        sessionId: session?.id,
        text,
        channel: TELEGRAM_CHANNEL,
        userId: String(chatId),
      });
    } catch (err) {
      await this.send(chatId, this.tr('tg.error', { message: (err as Error).message }));
      return;
    }
    state.sessionId = started.session.id;
    const turn: ActiveTurn = {
      turnId: started.turnId,
      sessionId: started.session.id,
      chatId,
      text: '',
      shown: '',
      lastEditAt: 0,
      files: [],
      editPausedUntil: 0,
      finished: false,
    };
    state.turn = turn;
    this.turns.set(turn.turnId, turn);
    this.startTyping(turn);
    started.done.catch(() => undefined);
  }

  private startTyping(turn: ActiveTurn): void {
    const tick = () => this.api.sendChatAction(turn.chatId).catch(() => false);
    void tick();
    turn.typingTimer = setInterval(tick, this.typingIntervalMs);
    turn.typingTimer.unref?.();
  }

  private clearTimers(turn: ActiveTurn): void {
    if (turn.flushTimer) clearTimeout(turn.flushTimer);
    if (turn.typingTimer) clearInterval(turn.typingTimer);
    turn.flushTimer = undefined;
    turn.typingTimer = undefined;
  }

  private onServerMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'event': {
        const turn = this.turns.get(m.turnId);
        if (!turn || turn.finished) return;
        const ev = m.event;
        if (ev.type === 'text') {
          turn.text += ev.delta;
          turn.statusLine = undefined;
          this.scheduleFlush(turn);
        } else if (ev.type === 'tool_start') {
          turn.toolLine = ev.summary;
          turn.statusLine = undefined;
          this.scheduleFlush(turn);
        } else if (ev.type === 'tool_end') {
          if (ev.files?.length) turn.files.push(...ev.files);
        } else if (ev.type === 'retry_wait') {
          // Free-tier pauses can last a minute: say so instead of looking frozen.
          turn.statusLine = this.tr('tg.waiting', { seconds: ev.seconds });
          this.scheduleFlush(turn);
        } else if (ev.type === 'model_switch') {
          turn.statusLine = this.tr('tg.switched', { model: ev.to });
          this.scheduleFlush(turn);
        } else if (ev.type === 'notice') {
          turn.statusLine = ev.message;
          this.scheduleFlush(turn);
        }
        return;
      }
      case 'approval':
        void this.onApproval(m.approval);
        return;
      case 'approval_resolved':
        void this.onApprovalResolved(m.id, m.answer);
        return;
      case 'turn_end': {
        const turn = this.turns.get(m.turnId);
        if (turn) void this.finish(turn, m);
        return;
      }
      default:
        return;
    }
  }

  private scheduleFlush(turn: ActiveTurn): void {
    if (!this.cfg.streaming || turn.flushTimer || turn.finished) return;
    const now = Date.now();
    const wait = Math.max(
      0,
      turn.lastEditAt + this.streamIntervalMs - now,
      turn.editPausedUntil - now,
    );
    turn.flushTimer = setTimeout(() => {
      turn.flushTimer = undefined;
      turn.inflight = this.flush(turn).finally(() => {
        turn.inflight = undefined;
      });
    }, wait);
    turn.flushTimer.unref?.();
  }

  /** Intermediate update: plain text (no markup — a half-written answer may not parse). */
  private async flush(turn: ActiveTurn): Promise<void> {
    if (turn.finished) return;
    let display: string;
    if (turn.text.trim()) {
      display =
        turn.text.length > STREAM_PREVIEW_CHARS
          ? `${turn.text.slice(0, STREAM_PREVIEW_CHARS)}…`
          : `${turn.text} ▍`;
    } else if (turn.statusLine) display = turn.statusLine;
    else if (turn.toolLine) display = this.tr('tg.tool', { summary: turn.toolLine });
    else display = this.tr('tg.working');
    if (display === turn.shown) return;
    turn.lastEditAt = Date.now();
    try {
      if (turn.messageId === undefined) {
        const sent = await this.api.sendMessage({ chat_id: turn.chatId, text: display });
        turn.messageId = sent.message_id;
      } else {
        await this.api.editMessageText({
          chat_id: turn.chatId,
          message_id: turn.messageId,
          text: display,
        });
      }
      turn.shown = display;
    } catch (err) {
      this.handleEditError(turn, err as TelegramError);
    }
  }

  private handleEditError(turn: ActiveTurn, err: TelegramError): void {
    if (err.code === 429) {
      turn.editPausedUntil = Date.now() + (err.retryAfter ?? 5) * 1000;
      return;
    }
    if (/message is not modified/i.test(err.message)) return;
    this.rt.logger.warn('telegram: edit failed', { error: err.message });
  }

  private async finish(
    turn: ActiveTurn,
    end: Extract<ServerMessage, { type: 'turn_end' }>,
  ): Promise<void> {
    turn.finished = true;
    this.clearTimers(turn);
    this.turns.delete(turn.turnId);
    const state = this.chats.get(turn.chatId);
    if (state?.turn === turn) state.turn = undefined;
    await turn.inflight;

    let chunks: string[];
    let html = true;
    if (!end.ok) {
      chunks = [this.tr('tg.error', { message: end.error?.message ?? 'unknown error' })];
      html = false;
    } else {
      const text = (end.text ?? turn.text).trim();
      if (!text) {
        chunks = [this.tr(end.finishReason === 'cancelled' ? 'tg.cancelled' : 'tg.empty')];
        html = false;
      } else {
        chunks = chunkHtml(markdownToTelegramHtml(text));
      }
    }
    // Wait out a 429 pause before the final edit so the answer is never lost.
    const pause = turn.editPausedUntil - Date.now();
    if (pause > 0) await sleep(Math.min(pause, 30_000));

    for (let i = 0; i < chunks.length; i++) {
      const body = chunks[i]!;
      const first = i === 0 && turn.messageId !== undefined;
      await this.deliver(turn.chatId, body, html, first ? turn.messageId : undefined);
    }
    for (const f of turn.files) await this.sendFile(turn.chatId, f);
  }

  /** Send (or edit into) a message, falling back to plain text if Telegram rejects the HTML. */
  private async deliver(
    chatId: number,
    body: string,
    html: boolean,
    editMessageId?: number,
  ): Promise<void> {
    const attempt = async (text: string, parse: boolean) => {
      const base = parse
        ? { text, parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } }
        : { text };
      if (editMessageId !== undefined) {
        await this.api.editMessageText({ chat_id: chatId, message_id: editMessageId, ...base });
      } else {
        await this.api.sendMessage({ chat_id: chatId, ...base });
      }
    };
    try {
      await attempt(body, html);
    } catch (err) {
      const e = err as TelegramError;
      if (html && e.code === 400) {
        await attempt(htmlToText(body), false).catch((e2: Error) =>
          this.rt.logger.warn('telegram: send failed', { error: e2.message }),
        );
      } else if (/message is not modified/i.test(e.message)) {
        return;
      } else if (editMessageId !== undefined && e.code === 400) {
        // The placeholder vanished (deleted by the user?) — send a fresh message.
        await this.api
          .sendMessage({ chat_id: chatId, text: html ? htmlToText(body) : body })
          .catch(() => undefined);
      } else {
        this.rt.logger.warn('telegram: send failed', { error: e.message });
      }
    }
  }

  private async sendFile(chatId: number, f: FileRefDTO): Promise<void> {
    try {
      const st = fs.statSync(f.path);
      if (!st.isFile()) return;
      if (st.size > MAX_UPLOAD_BYTES) {
        await this.send(
          chatId,
          this.tr('tg.file_too_big', {
            name: f.name,
            size: `${Math.round(st.size / 1024 / 1024)} MB`,
            path: f.path,
          }),
        );
        return;
      }
      const data = fs.readFileSync(f.path);
      await this.api.sendDocument(chatId, { name: f.name, data, mime: f.mime }, f.name);
    } catch (err) {
      this.rt.logger.warn('telegram: sendDocument failed', {
        file: f.path,
        error: (err as Error).message,
      });
    }
  }

  private send(chatId: number, text: string) {
    return this.api.sendMessage({ chat_id: chatId, text });
  }

  // ---- approvals ------------------------------------------------------------

  private chatForSession(sessionId: string): number | undefined {
    for (const turn of this.turns.values()) if (turn.sessionId === sessionId) return turn.chatId;
    const session = this.rt.store.get(sessionId);
    if (session?.channel === TELEGRAM_CHANNEL && session.userId) return Number(session.userId);
    return undefined;
  }

  private async onApproval(a: ApprovalDTO): Promise<void> {
    const chatId = this.chatForSession(a.sessionId);
    if (chatId === undefined) return;
    const args = a.args.length > 1500 ? `${a.args.slice(0, 1500)}…` : a.args;
    const text = this.tr('tg.approval', {
      summary: escapeHtml(a.summary),
      args: `<pre>${escapeHtml(args)}</pre>`,
    });
    try {
      const sent = await this.api.sendMessage({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: this.tr('tg.approval.allow'), callback_data: `apr:${a.id}:allow` },
              { text: this.tr('tg.approval.always'), callback_data: `apr:${a.id}:always` },
            ],
            [{ text: this.tr('tg.approval.deny'), callback_data: `apr:${a.id}:deny` }],
          ],
        },
      });
      this.approvalMsgs.set(a.id, { chatId, messageId: sent.message_id, summary: a.summary });
    } catch (err) {
      this.rt.logger.warn('telegram: approval message failed', { error: (err as Error).message });
    }
  }

  private async onApprovalResolved(id: string, answer: ApprovalAnswer): Promise<void> {
    const m = this.approvalMsgs.get(id);
    if (!m) return;
    this.approvalMsgs.delete(id);
    const key = answer === 'deny' ? 'tg.approval.resolved.deny' : 'tg.approval.resolved.allow';
    await this.api
      .editMessageText({
        chat_id: m.chatId,
        message_id: m.messageId,
        text: this.tr(key, { summary: m.summary }),
        reply_markup: { inline_keyboard: [] },
      })
      .catch(() => undefined);
  }

  private async handleCallback(cb: TgCallbackQuery): Promise<void> {
    const chatId = cb.message?.chat.id;
    const m = /^apr:([^:]+):(allow|always|deny)$/.exec(cb.data ?? '');
    if (!m || chatId === undefined || !this.isAllowed(chatId)) {
      await this.api.answerCallbackQuery(cb.id).catch(() => false);
      return;
    }
    const ok = this.manager.answer(m[1]!, m[2] as ApprovalAnswer);
    await this.api
      .answerCallbackQuery(cb.id, ok ? undefined : this.tr('tg.approval.gone'))
      .catch(() => false);
  }
}
