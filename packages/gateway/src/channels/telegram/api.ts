/**
 * Minimal Telegram Bot API client (the handful of methods SINDAR needs).
 * Plain `fetch`, injectable for tests, no webhook — long polling works from a phone behind NAT.
 */

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
  user?: TgUser;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  reply_to_message?: TgMessage;
  photo?: unknown[];
  document?: { file_name?: string; mime_type?: string };
  voice?: unknown;
  audio?: unknown;
  video?: unknown;
  sticker?: unknown;
  new_chat_members?: TgUser[];
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: unknown;
}

export interface TgInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgReplyMarkup {
  inline_keyboard: TgInlineKeyboardButton[][];
}

export interface TgSendMessage {
  chat_id: number | string;
  text: string;
  parse_mode?: 'HTML';
  reply_markup?: TgReplyMarkup;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
  link_preview_options?: { is_disabled: boolean };
  message_thread_id?: number;
}

export interface TgEditMessageText {
  chat_id: number | string;
  message_id: number;
  text: string;
  parse_mode?: 'HTML';
  reply_markup?: TgReplyMarkup;
  link_preview_options?: { is_disabled: boolean };
}

export interface TgBotCommand {
  command: string;
  description: string;
}

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly retryAfter?: number,
    readonly method?: string,
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

export interface TelegramApiOptions {
  fetch?: typeof fetch;
  /** Default https://api.telegram.org */
  apiBase?: string;
  /** Per-call timeout for ordinary methods (ms). */
  timeoutMs?: number;
}

type Params = object;

export class TelegramApi {
  private readonly fetchFn: typeof fetch;
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(
    readonly token: string,
    opts: TelegramApiOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.base = (opts.apiBase ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** Call any Bot API method; JSON body unless a file is attached (then multipart). */
  async call<T = unknown>(
    method: string,
    params: Params = {},
    opts: {
      signal?: AbortSignal;
      timeoutMs?: number;
      file?: { field: string; name: string; data: Uint8Array; mime?: string };
    } = {},
  ): Promise<T> {
    const url = `${this.base}/bot${this.token}/${method}`;
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let init: RequestInit;
    if (opts.file) {
      const form = new FormData();
      for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
        if (v === undefined) continue;
        form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      const blob = new Blob([opts.file.data as unknown as ArrayBuffer], {
        type: opts.file.mime ?? 'application/octet-stream',
      });
      form.append(opts.file.field, blob, opts.file.name);
      init = { method: 'POST', body: form, signal };
    } else {
      init = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal,
      };
    }
    let res: Response;
    try {
      res = await this.fetchFn(url, init);
    } catch (err) {
      const e = err as Error;
      throw new TelegramError(
        `${method}: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`,
        0,
        undefined,
        method,
      );
    }
    let body: {
      ok: boolean;
      result?: T;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new TelegramError(
        `${method}: HTTP ${res.status} (invalid JSON)`,
        res.status,
        undefined,
        method,
      );
    }
    if (!body.ok) {
      throw new TelegramError(
        `${method}: ${body.description ?? `HTTP ${res.status}`}`,
        body.error_code ?? res.status,
        body.parameters?.retry_after,
        method,
      );
    }
    return body.result as T;
  }

  getMe(signal?: AbortSignal): Promise<TgUser> {
    return this.call<TgUser>('getMe', {}, { signal, timeoutMs: 15_000 });
  }

  deleteWebhook(): Promise<boolean> {
    return this.call<boolean>('deleteWebhook', { drop_pending_updates: false });
  }

  setMyCommands(commands: TgBotCommand[], languageCode?: string): Promise<boolean> {
    return this.call<boolean>('setMyCommands', {
      commands,
      ...(languageCode ? { language_code: languageCode } : {}),
    });
  }

  /** Long poll: resolves after `timeout` seconds at most (the HTTP timeout allows for slack). */
  getUpdates(
    params: { offset?: number; timeout?: number; allowed_updates?: string[] },
    signal?: AbortSignal,
  ): Promise<TgUpdate[]> {
    const t = params.timeout ?? 30;
    return this.call<TgUpdate[]>('getUpdates', params, { signal, timeoutMs: (t + 15) * 1000 });
  }

  sendMessage(params: TgSendMessage): Promise<TgMessage> {
    return this.call<TgMessage>('sendMessage', params);
  }

  editMessageText(params: TgEditMessageText): Promise<TgMessage | true> {
    return this.call<TgMessage | true>('editMessageText', params);
  }

  deleteMessage(chat_id: number | string, message_id: number): Promise<boolean> {
    return this.call<boolean>('deleteMessage', { chat_id, message_id });
  }

  sendChatAction(chat_id: number | string, action = 'typing'): Promise<boolean> {
    return this.call<boolean>('sendChatAction', { chat_id, action }, { timeoutMs: 10_000 });
  }

  answerCallbackQuery(callback_query_id: string, text?: string): Promise<boolean> {
    return this.call<boolean>('answerCallbackQuery', {
      callback_query_id,
      ...(text ? { text } : {}),
    });
  }

  sendDocument(
    chat_id: number | string,
    file: { name: string; data: Uint8Array; mime?: string },
    caption?: string,
  ): Promise<TgMessage> {
    return this.call<TgMessage>(
      'sendDocument',
      { chat_id, ...(caption ? { caption } : {}) },
      { file: { field: 'document', ...file }, timeoutMs: 120_000 },
    );
  }
}
