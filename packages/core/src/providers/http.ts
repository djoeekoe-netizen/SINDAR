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
  if (status === 400 || status === 422 || status === 413) return 'invalid_request';
  if (status >= 500) return 'server';
  return 'unknown';
}

export async function httpError(res: Response, provider: string): Promise<ProviderError> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  const code = codeForStatus(res.status);
  const detail = errorMessageFromBody(body);
  const prefix = `${provider}: HTTP ${res.status}`;
  const err = new ProviderError(detail ? `${prefix} — ${detail}` : prefix, code, res.status);
  const wait = parseRetryAfter(res.headers.get('retry-after'), detail || body);
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
