import { ProviderError, type ProviderErrorCode } from './types.js';

export type FetchLike = typeof fetch;

/** Extract a human-readable message from a JSON or text error body. */
export function errorMessageFromBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    const err = (j.error ?? j) as Record<string, unknown> | string;
    if (typeof err === 'string') return err;
    const msg = err.message ?? err.msg ?? err.detail ?? j.message ?? j.detail;
    if (typeof msg === 'string') return msg;
    if (Array.isArray(msg))
      return msg.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('; ');
  } catch {
    /* not JSON */
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

export function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'not_found';
  if (status === 413) return 'too_large';
  if (status === 400 || status === 422) return 'invalid_request';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * Does this error text say that the request itself is too big? Covers Groq's 413
 * ("Request too large … tokens per minute (TPM): Limit 8000, Requested 11818"), OpenAI's
 * `context_length_exceeded` ("maximum context length is 8192 tokens. However, you requested
 * 9000 tokens"), Anthropic's "prompt is too long: 210000 tokens > 200000 maximum" and friends.
 */
export function isTooLargeMessage(text: string): boolean {
  return /request too large|too (?:large|long)|context[_ ]length|maximum context|exceeds? the (?:maximum|model)|too many tokens|reduce (?:the length of )?(?:your|the) (?:message|prompt|input)|input is too long|prompt is too long/i.test(
    text,
  );
}

/** Pull "Limit N" / "Requested N" style numbers (tokens) out of a too-large error text. */
export function parseTokenLimits(text: string): {
  limit?: number;
  requested?: number;
  used?: number;
} {
  const num = (re: RegExp) => {
    const m = re.exec(text);
    return m ? Number.parseInt(m[1]!.replace(/[,_]/g, ''), 10) : undefined;
  };
  const limit =
    num(/limit:?\s*([\d,_]+)/i) ??
    num(/maximum context length is\s*([\d,_]+)/i) ??
    num(/([\d,_]+)\s*maximum/i) ??
    num(/(?:max(?:imum)?|limit) of\s*([\d,_]+)\s*tokens/i);
  const requested =
    num(/requested:?\s*([\d,_]+)/i) ??
    num(/you requested\s*([\d,_]+)/i) ??
    num(/(?:prompt|input|messages?) (?:is|are|resulted in)\s*([\d,_]+)\s*tokens/i) ??
    num(/([\d,_]+)\s*tokens\s*>/i);
  const used = num(/\bused:?\s*([\d,_]+)/i);
  return {
    limit: limit && Number.isFinite(limit) ? limit : undefined,
    requested: requested && Number.isFinite(requested) ? requested : undefined,
    used: used && Number.isFinite(used) ? used : undefined,
  };
}

export async function httpError(res: Response, provider: string): Promise<ProviderError> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  const detail = errorMessageFromBody(body);
  const text = detail || body;
  // Groq reports an oversized single request as 413; others as 400 with a telling message.
  // A 429 whose text says the *request* is too large is also hopeless to retry unchanged.
  const tooLarge =
    res.status === 413 ||
    ((res.status === 400 || res.status === 422 || res.status === 429) && isTooLargeMessage(text));
  const code = tooLarge ? 'too_large' : codeForStatus(res.status);
  const prefix = `${provider}: HTTP ${res.status}`;
  const err = new ProviderError(detail ? `${prefix} — ${detail}` : prefix, code, res.status);
  if (tooLarge) {
    const { limit, requested } = parseTokenLimits(text);
    err.limitTokens = limit;
    err.requestedTokens = requested;
  } else if (res.status === 429) {
    // Groq: "Rate limit reached … tokens per minute (TPM): Limit 8000, Used 6895, Requested 7693"
    const { limit, requested, used } = parseTokenLimits(text);
    err.perMinute = /per minute|\bTPM\b/i.test(text);
    if (err.perMinute) {
      err.limitTokens = limit;
      err.requestedTokens = requested;
      err.usedTokens = used;
    }
  }
  const wait = parseRetryAfter(res.headers.get('retry-after'), text);
  if (wait !== undefined) err.retryAfterMs = wait;
  return err;
}

/**
 * Retry-After header (seconds or HTTP date) or phrases like "try again in 10.9s" /
 * "retry after 2 seconds" / "in 1m30s" inside the error text → milliseconds.
 */
export function parseRetryAfter(header: string | null, text = ''): number | undefined {
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
    const at = Date.parse(header);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  }
  const m =
    /(?:try again|retry)\s*(?:after|in)\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(\d+(?:\.\d+)?)\s*(ms|s|sec(?:ond)?s?)?/i.exec(
      text,
    );
  if (!m) return undefined;
  const minutes = m[1] ? Number(m[1]) : 0;
  const n = Number(m[2]);
  const unit = (m[3] ?? 's').toLowerCase();
  const ms = unit === 'ms' ? n : n * 1000;
  return Math.ceil(minutes * 60_000 + ms);
}

/** True for connection-level failures (no internet, DNS, timeout, reset) as opposed to HTTP errors. */
export const NETWORK_ERROR_RE =
  /fetch failed|UND_ERR|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|idle timeout|network/i;
export function isNetworkErrorMessage(message: string): boolean {
  return NETWORK_ERROR_RE.test(message);
}

/** Wrap network-level failures (DNS, refused, aborted) into ProviderError. */
export function networkError(err: unknown, provider: string, cancelled = false): ProviderError {
  if (cancelled) return new ProviderError(`${provider}: cancelled`, 'unknown', undefined, false);
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const cause = e?.cause?.code ?? e?.cause?.message ?? '';
  const msg = e?.message ?? String(err);
  return new ProviderError(`${provider}: ${msg}${cause ? ` (${cause})` : ''}`, 'network');
}

export function isAbortError(err: unknown): boolean {
  return (err as { name?: string })?.name === 'AbortError';
}

/** Combine an optional caller signal with a timeout. */
export function withTimeout(
  ms: number,
  signal?: AbortSignal,
): { signal: AbortSignal; clear: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`timeout after ${ms}ms`)), ms);
  const onAbort = () => ctl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctl.signal,
    clear: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export interface SseMessage {
  event?: string;
  data: string;
}

/** Minimal Server-Sent-Events parser over a fetch body. */
export async function* parseSse(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  // Aborting cancels the pending read right away (the stream then reports `done`), so callers
  // never sit on a stalled connection waiting for the next chunk that may never come.
  const cancel = () => void reader.cancel(signal?.reason).catch(() => undefined);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const flush = (block: string): SseMessage | undefined => {
    let event: string | undefined;
    const data: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line || line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? '' : line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length === 0) return undefined;
    return { event, data: data.join('\n') };
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.search(/\r?\n\r?\n/)) !== -1) {
        const match = /\r?\n\r?\n/.exec(buf.slice(sep))!;
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + match[0].length);
        const msg = flush(block);
        if (msg) yield msg;
      }
    }
    buf += decoder.decode();
    if (buf.trim()) {
      const msg = flush(buf);
      if (msg) yield msg;
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export function authHeaders(
  apiKey: string | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...extra,
  };
  if (apiKey) h.authorization = `Bearer ${apiKey}`;
  return h;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
