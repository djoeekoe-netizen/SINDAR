import { z } from 'zod';
import { defineTool, type Tool, type ToolRiskDetail } from './types.js';

/**
 * Pages are fetched on the user's own device at the user's request, so we present ourselves the
 * way their browser would: many news sites (WAF "bot" rules) answer 403 to anything else.
 */
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UA = MOBILE_UA;

export function browserHeaders(lang: string, ua: string = MOBILE_UA): Record<string, string> {
  return {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': lang === 'ar' ? 'ar,en-US;q=0.8,en;q=0.6' : 'en-US,en;q=0.9,ar;q=0.5',
    'upgrade-insecure-requests': '1',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'cache-control': 'max-age=0',
  };
}

/** Free public fallbacks for pages that refuse automated readers. Override/disable via env. */
export const DEFAULT_READER_PROXY = 'https://r.jina.ai/';
export const DEFAULT_WAYBACK_API = 'https://archive.org/wayback/available?url=';

const BLOCK_STATUSES = new Set([
  401, 403, 405, 406, 409, 418, 429, 451, 500, 502, 503, 520, 521, 522, 523, 524,
]);
const BLOCK_PAGE =
  /just a moment|checking your browser|cf-chl|captcha|access denied|request blocked|has been blocked|verify you are human|enable javascript and cookies|attention required|تم رفض الوصول|تم حظر طلبك/i;

/** A 200 that is really a bot wall (Cloudflare challenge, Akamai "Access Denied"…). */
export function looksLikeBlockPage(text: string): boolean {
  return text.length < 20_000 && BLOCK_PAGE.test(text.slice(0, 6000));
}

export interface ReadableResult {
  url: string;
  title?: string;
  text: string;
  /** How the text was obtained. */
  via: 'direct' | 'desktop-ua' | 'reader' | 'archive';
  note?: string;
}

export interface FetchReadableOptions {
  fetch?: typeof fetch;
  lang?: string;
  signal?: AbortSignal;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  readerProxy?: string | false;
  waybackApi?: string | false;
  onProgress?: (line: string) => void;
}

function withTimeout(ms: number, parent?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return parent ? AbortSignal.any([parent, t]) : t;
}

function bodyToText(raw: string, type: string, url: string): { title?: string; text: string } {
  if (/json/i.test(type)) {
    try {
      return { text: JSON.stringify(JSON.parse(raw), null, 2) };
    } catch {
      return { text: raw };
    }
  }
  if (/html/i.test(type) || /^\s*<!doctype html|^\s*<html/i.test(raw)) return htmlToText(raw, url);
  return { text: raw };
}

/** Parse the plain-text envelope of r.jina.ai ("Title: …", "URL Source: …", "Markdown Content:"). */
export function parseReaderEnvelope(
  raw: string,
): { title?: string; text: string; targetError?: string } | undefined {
  const m = /^Title:\s*(.*)$/m.exec(raw);
  const warn = /^Warning:\s*Target URL returned error\s*(\d+[^\n]*)/m.exec(raw);
  const idx = raw.indexOf('Markdown Content:');
  const text = (idx >= 0 ? raw.slice(idx + 'Markdown Content:'.length) : raw).trim();
  if (!text) return undefined;
  return { title: m?.[1]?.trim() || undefined, text, targetError: warn?.[1]?.trim() };
}

/**
 * Get readable text for a public URL, trying in order: the page itself with browser headers,
 * the page with a desktop UA, a reader proxy, and finally the Wayback Machine. Pure (injectable
 * fetch) so it can be tested offline. Throws with a user-explainable message when everything fails.
 */
export async function fetchReadable(
  target: string,
  opts: FetchReadableOptions = {},
): Promise<ReadableResult> {
  const f = opts.fetch ?? fetch;
  const lang = opts.lang ?? 'en';
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const reader = opts.readerProxy === undefined ? DEFAULT_READER_PROXY : opts.readerProxy;
  const wayback = opts.waybackApi === undefined ? DEFAULT_WAYBACK_API : opts.waybackApi;
  const failures: string[] = [];
  /** Set when retrying elsewhere makes no sense (404, security refusal…). */
  let fatal: string | undefined;
  const say = (line: string) => opts.onProgress?.(line);

  const direct = async (
    ua: string,
    via: 'direct' | 'desktop-ua',
  ): Promise<ReadableResult | undefined> => {
    try {
      const res = await f(target, {
        headers: browserHeaders(lang, ua),
        redirect: 'follow',
        signal: withTimeout(timeoutMs, opts.signal),
      });
      const finalUrl = res.url || target;
      if (isPrivateHost(new URL(finalUrl).hostname)) {
        fatal = 'redirect to a private address was blocked';
        return undefined;
      }
      const type = res.headers.get('content-type') ?? '';
      const raw = await res.text();
      if (!res.ok) {
        const msg = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
        failures.push(msg);
        if (!BLOCK_STATUSES.has(res.status)) fatal = msg;
        return undefined;
      }
      const conv = bodyToText(raw, type, finalUrl);
      if (/html/i.test(type) && looksLikeBlockPage(conv.text)) {
        failures.push('bot wall (page says access denied / verify you are human)');
        return undefined;
      }
      return { url: finalUrl, title: conv.title, text: conv.text, via };
    } catch (err) {
      if (opts.signal?.aborted) throw new Error('cancelled', { cause: err });
      const msg = (err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message;
      if (!failures.includes(msg)) failures.push(msg);
      // a hard transport error (DNS, TLS) will not improve with another UA — still worth the proxies
      return undefined;
    }
  };

  const viaReader = async (): Promise<ReadableResult | undefined> => {
    if (!reader) return undefined;
    say(
      lang === 'ar'
        ? 'الموقع رفض الطلب — أجرّب قارئاً وسيطاً…'
        : 'site refused — trying a reader proxy…',
    );
    try {
      const res = await f(`${reader}${target}`, {
        headers: { accept: 'text/plain', 'user-agent': DESKTOP_UA, 'x-no-cache': 'true' },
        signal: withTimeout(timeoutMs + 5000, opts.signal),
      });
      const raw = await res.text();
      if (!res.ok) {
        failures.push(`reader proxy HTTP ${res.status}`);
        return undefined;
      }
      const env = parseReaderEnvelope(raw);
      if (!env || env.targetError || looksLikeBlockPage(env.text)) {
        failures.push(`reader proxy: target answered ${env?.targetError ?? 'a block page'}`);
        return undefined;
      }
      return {
        url: target,
        title: env.title,
        text: env.text,
        via: 'reader',
        note: 'via reader proxy',
      };
    } catch (err) {
      if (opts.signal?.aborted) throw new Error('cancelled', { cause: err });
      failures.push(
        `reader proxy: ${(err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message}`,
      );
      return undefined;
    }
  };

  const viaArchive = async (): Promise<ReadableResult | undefined> => {
    if (!wayback) return undefined;
    say(lang === 'ar' ? 'أبحث عن نسخة محفوظة في أرشيف الإنترنت…' : 'looking for an archived copy…');
    try {
      const avail = await f(`${wayback}${encodeURIComponent(target)}`, {
        headers: { accept: 'application/json', 'user-agent': DESKTOP_UA },
        signal: withTimeout(timeoutMs, opts.signal),
      });
      if (!avail.ok) {
        failures.push(`archive lookup HTTP ${avail.status}`);
        return undefined;
      }
      const j = (await avail.json()) as {
        archived_snapshots?: {
          closest?: { available?: boolean; url?: string; timestamp?: string };
        };
      };
      const snap = j.archived_snapshots?.closest;
      if (!snap?.available || !snap.url) {
        failures.push('no archived copy');
        return undefined;
      }
      // "id_" returns the original bytes without the Wayback toolbar.
      const rawUrl = snap.url.replace(/\/web\/(\d+)\//, '/web/$1id_/');
      const res = await f(rawUrl, {
        headers: browserHeaders(lang, DESKTOP_UA),
        redirect: 'follow',
        signal: withTimeout(timeoutMs + 5000, opts.signal),
      });
      if (!res.ok) {
        failures.push(`archive copy HTTP ${res.status}`);
        return undefined;
      }
      const conv = bodyToText(
        await res.text(),
        res.headers.get('content-type') ?? 'text/html',
        target,
      );
      const ts = snap.timestamp ?? '';
      const date =
        ts.length >= 8 ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : 'unknown date';
      return {
        url: target,
        title: conv.title,
        text: conv.text,
        via: 'archive',
        note: `archived copy from ${date} (the live page refused automated access)`,
      };
    } catch (err) {
      if (opts.signal?.aborted) throw new Error('cancelled', { cause: err });
      failures.push(
        `archive: ${(err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message}`,
      );
      return undefined;
    }
  };

  let got = await direct(MOBILE_UA, 'direct');
  if (fatal) throw new Error(fatal);
  got ??= await direct(DESKTOP_UA, 'desktop-ua');
  if (fatal) throw new Error(fatal);
  got ??= (await viaReader()) ?? (await viaArchive());
  if (got) return got;
  const first = failures[0] ?? 'unknown error';
  const blocked = /^HTTP 4|bot wall/.test(first);
  throw new Error(
    blocked
      ? `${first} — the site blocks automated readers (also tried a reader proxy and the Wayback Machine: ${failures.slice(1).join('; ') || 'unavailable'}). Tell the user the site refuses automatic access; ask them to paste the text, or use web_search to find the same story on another site.`
      : `fetch failed: ${failures.join('; ')}`,
  );
}

/** Basic SSRF guard — private/loopback/link-local hosts are refused (DNS-level checks come in M7). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  )
    return true;
  if (
    h === '::1' ||
    h === '0.0.0.0' ||
    h.startsWith('fe80:') ||
    h.startsWith('fc') ||
    h.startsWith('fd')
  )
    return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

/** Convert HTML into compact readable text with a Markdown flavour. */
export function htmlToText(html: string, baseUrl?: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|canvas|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(nav|footer|aside|header)[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, n: string, inner: string) => `\n\n${'#'.repeat(Number(n))} ${inner}\n\n`,
    )
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|tr|table|ul|ol|blockquote|pre)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, inner: string) => {
        const label = inner.replace(/<[^>]+>/g, '').trim();
        if (!label) return '';
        let url = href;
        try {
          url = baseUrl ? new URL(href, baseUrl).toString() : href;
        } catch {
          /* keep */
        }
        return url.startsWith('http') && label !== url ? `[${label}](${url})` : label;
      },
    )
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { title: title ? decodeEntities(title) : undefined, text: s };
}

const networkRisk = (): ToolRiskDetail => ({ risk: 'network' });

export const webFetch = defineTool({
  name: 'web_fetch',
  toolset: 'web',
  risk: 'network',
  description:
    'Fetch a public web page (or JSON/text URL) and return readable text. If the site blocks automated readers it automatically tries a reader proxy and an archived copy; when even that fails, tell the user instead of retrying. Not for private/local addresses.',
  parameters: z.object({
    url: z.string().url().describe('http(s) URL'),
    max_chars: z
      .number()
      .int()
      .min(500)
      .max(100_000)
      .optional()
      .describe('Trim the result (default 12000)'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Skip this many characters of the page text first (to read the next part)'),
  }),
  summarize: (a) => `fetch ${a.url}`,
  classify: networkRisk,
  async execute(args, ctx) {
    const u = new URL(args.url);
    if (!/^https?:$/.test(u.protocol))
      return { content: 'error: only http(s) URLs are allowed', isError: true };
    if (isPrivateHost(u.hostname))
      return { content: 'error: private/local addresses are blocked', isError: true };
    const envOf = (key: string, fallback: string): string | false => {
      const v = ctx.env[key]?.trim();
      if (!v) return fallback;
      return /^(off|0|false|none)$/i.test(v) ? false : v;
    };
    try {
      const page = await fetchReadable(u.toString(), {
        lang: ctx.lang,
        signal: ctx.signal,
        readerProxy: envOf('SINDAR_READER_PROXY', DEFAULT_READER_PROXY),
        waybackApi: envOf('SINDAR_WAYBACK_API', DEFAULT_WAYBACK_API),
        onProgress: ctx.onProgress?.bind(ctx),
      });
      const max = args.max_chars ?? 12_000;
      const body = page.text;
      const offset = Math.min(args.offset ?? 0, body.length);
      const part = body.slice(offset, offset + max);
      const rest = body.length - offset - part.length;
      const trimmed =
        rest > 0
          ? `${part}\n…[${rest} more chars — call web_fetch again with offset=${offset + part.length} to continue]`
          : part;
      const head = [
        page.title ? `# ${page.title}` : '',
        `URL: ${page.url}${offset ? ` (from char ${offset})` : ''}${page.note ? ` — ${page.note}` : ''}`,
      ]
        .filter(Boolean)
        .join('\n');
      return {
        content: `${head}\n\n${trimmed}`,
        meta: { url: page.url, title: page.title, chars: body.length, offset, via: page.via },
      };
    } catch (err) {
      return { content: `error: ${(err as Error).message}`, isError: true };
    }
  },
});

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function parseDuckDuckGo(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const b of blocks) {
    const a = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!a) continue;
    let url = decodeEntities(a[1]!);
    const m = /[?&]uddg=([^&]+)/.exec(url);
    if (m) url = decodeURIComponent(m[1]!);
    if (url.startsWith('//')) url = `https:${url}`;
    const title = decodeEntities(a[2]!.replace(/<[^>]+>/g, '')).trim();
    const sn = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|div|span)>/i.exec(b);
    const snippet = sn
      ? decodeEntities(sn[1]!.replace(/<[^>]+>/g, ''))
          .replace(/\s+/g, ' ')
          .trim()
      : '';
    if (title && url.startsWith('http') && !/duckduckgo\.com\/y\.js/.test(url))
      out.push({ title, url, snippet });
  }
  return out;
}

export const webSearch = defineTool({
  name: 'web_search',
  toolset: 'web',
  risk: 'network',
  description:
    'Search the web (DuckDuckGo, no API key needed). Returns titles, URLs and snippets; follow up with web_fetch for details.',
  parameters: z.object({
    query: z.string().min(1).describe('Search query'),
    max_results: z.number().int().min(1).max(20).optional().describe('Default 6'),
  }),
  summarize: (a) => `search web: ${a.query}`,
  classify: networkRisk,
  async execute(args, ctx) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    const onAbort = () => ctl.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`,
        {
          headers: browserHeaders(ctx.lang, UA),
          signal: ctl.signal,
        },
      );
      if (!res.ok) return { content: `error: search returned HTTP ${res.status}`, isError: true };
      const results = parseDuckDuckGo(await res.text()).slice(0, args.max_results ?? 6);
      if (results.length === 0)
        return {
          content:
            'no results (or the search page could not be parsed) — try web_fetch on a known site',
        };
      return {
        content: results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
          .join('\n'),
        meta: { results },
      };
    } catch (err) {
      return {
        content: `error: search failed: ${ctl.signal.aborted ? 'timeout/cancelled' : (err as Error).message}`,
        isError: true,
      };
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  },
});

export const WEB_TOOLS: Tool[] = [webFetch as Tool, webSearch as Tool];
