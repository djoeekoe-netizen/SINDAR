/**
 * In-process stand-in for api.telegram.org: a `fetch` implementation that understands the
 * handful of Bot API methods SINDAR uses, records every call and lets tests push updates.
 */
import type { TgCallbackQuery, TgMessage, TgUpdate, TgUser } from '../src/index.js';

export const GOOD_TOKEN = `123456:${'a'.repeat(35)}`;

export interface FakeMessage {
  message_id: number;
  chat_id: number;
  text: string;
  parse_mode?: string;
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> };
  edits: number;
}

export interface FakeCall {
  method: string;
  params: Record<string, unknown>;
}

const ALLOWED_TAGS = new Set(['b', 'i', 's', 'u', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler']);

export function fakeTelegram(
  bot: TgUser = {
    id: 42,
    is_bot: true,
    first_name: 'SINDAR test',
    username: 'sindar_test_bot',
  },
) {
  const calls: FakeCall[] = [];
  const messages = new Map<number, FakeMessage>();
  const documents: Array<{ chat_id: number; name: string; size: number; caption?: string }> = [];
  let queue: TgUpdate[] = [];
  let waiter: ((u: TgUpdate[]) => void) | undefined;
  let nextUpdateId = 1;
  let nextMessageId = 100;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const ok = (result: unknown) => json(200, { ok: true, result });
  const fail = (code: number, description: string, retryAfter?: number) =>
    json(code, {
      ok: false,
      error_code: code,
      description,
      ...(retryAfter ? { parameters: { retry_after: retryAfter } } : {}),
    });

  const validHtml = (text: string): boolean => {
    const re = /<\/?([a-zA-Z-]+)(?:\s[^>]*)?>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) if (!ALLOWED_TAGS.has(m[1]!.toLowerCase())) return false;
    return true;
  };

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const m = /\/bot([^/]+)\/(\w+)$/.exec(url);
    if (!m) return fail(404, 'Not Found');
    const [, token, method] = m;
    let params: Record<string, unknown> = {};
    if (init?.body instanceof FormData) {
      for (const [k, v] of init.body.entries()) params[k] = v;
    } else if (typeof init?.body === 'string')
      params = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ method: method!, params });
    if (token !== GOOD_TOKEN) return fail(401, 'Unauthorized');

    switch (method) {
      case 'getMe':
        return ok(bot);
      case 'deleteWebhook':
      case 'setMyCommands':
      case 'sendChatAction':
      case 'answerCallbackQuery':
      case 'deleteMessage':
        return ok(true);
      case 'getUpdates': {
        const offset = Number(params.offset ?? 0);
        queue = queue.filter((u) => u.update_id >= offset);
        if (queue.length) return ok(queue);
        const timeoutMs = Number(params.timeout ?? 0) * 1000;
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => {
            waiter = undefined;
            resolve(ok([]));
          }, timeoutMs);
          waiter = (u) => {
            clearTimeout(timer);
            waiter = undefined;
            resolve(ok(u));
          };
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            waiter = undefined;
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      case 'sendMessage': {
        const text = String(params.text ?? '');
        if (!text) return fail(400, 'Bad Request: message text is empty');
        if (text.length > 4096) return fail(400, 'Bad Request: message is too long');
        if (params.parse_mode === 'HTML' && !validHtml(text))
          return fail(400, "Bad Request: can't parse entities");
        const id = nextMessageId++;
        const msg: FakeMessage = {
          message_id: id,
          chat_id: Number(params.chat_id),
          text,
          parse_mode: params.parse_mode as string | undefined,
          reply_markup: params.reply_markup as FakeMessage['reply_markup'],
          edits: 0,
        };
        messages.set(id, msg);
        return ok({ message_id: id, chat: { id: msg.chat_id, type: 'private' }, date: 0, text });
      }
      case 'editMessageText': {
        const msg = messages.get(Number(params.message_id));
        if (!msg) return fail(400, 'Bad Request: message to edit not found');
        const text = String(params.text ?? '');
        if (params.parse_mode === 'HTML' && !validHtml(text))
          return fail(400, "Bad Request: can't parse entities");
        if (msg.text === text) return fail(400, 'Bad Request: message is not modified');
        msg.text = text;
        msg.parse_mode = params.parse_mode as string | undefined;
        msg.reply_markup = params.reply_markup as FakeMessage['reply_markup'];
        msg.edits++;
        return ok(true);
      }
      case 'sendDocument': {
        const file = params.document as File | undefined;
        if (!file) return fail(400, 'Bad Request: no document');
        documents.push({
          chat_id: Number(params.chat_id),
          name: file.name,
          size: file.size,
          caption: params.caption as string | undefined,
        });
        return ok({ message_id: nextMessageId++, chat: { id: params.chat_id }, date: 0 });
      }
      default:
        return fail(404, `Not Found: ${method}`);
    }
  };

  function push(update: Omit<TgUpdate, 'update_id'>): TgUpdate {
    const u = { update_id: nextUpdateId++, ...update } as TgUpdate;
    queue.push(u);
    if (waiter) waiter(queue);
    return u;
  }

  function user(id: number, name = `User${id}`): TgUser {
    return { id, is_bot: false, first_name: name, username: `user${id}` };
  }

  function message(chatId: number, text: string, extra: Partial<TgMessage> = {}): TgMessage {
    return {
      message_id: nextMessageId++,
      from: user(chatId),
      chat: { id: chatId, type: chatId < 0 ? 'group' : 'private', first_name: `User${chatId}` },
      date: Math.floor(Date.now() / 1000),
      text,
      ...extra,
    };
  }

  return {
    bot,
    calls,
    messages,
    documents,
    fetch: fetchFn,
    push,
    user,
    message,
    /** Simulate a user typing `text` in chat `chatId`. */
    say(chatId: number, text: string, extra: Partial<TgMessage> = {}) {
      return push({ message: message(chatId, text, extra) });
    },
    /** Simulate tapping an inline button. */
    tap(chatId: number, messageId: number, data: string) {
      const cb: TgCallbackQuery = {
        id: `cb${nextUpdateId}`,
        from: user(chatId),
        data,
        message: { ...message(chatId, ''), message_id: messageId },
      };
      return push({ callback_query: cb });
    },
    /** Messages the bot sent to a chat, oldest first. */
    sentTo(chatId: number): FakeMessage[] {
      return [...messages.values()].filter((m) => m.chat_id === chatId);
    },
    callsOf(method: string): FakeCall[] {
      return calls.filter((c) => c.method === method);
    },
  };
}

export type FakeTelegram = ReturnType<typeof fakeTelegram>;

export async function waitFor<T>(
  fn: () => T | undefined | false | null,
  opts: { timeoutMs?: number; stepMs?: number; label?: string } = {},
): Promise<T> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5000);
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() > deadline) throw new Error(`waitFor timed out: ${opts.label ?? 'condition'}`);
    await new Promise((r) => setTimeout(r, opts.stepMs ?? 20));
  }
}
