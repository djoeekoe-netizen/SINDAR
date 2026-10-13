import { z } from 'zod';
import { defineTool, type Tool, type ToolRiskDetail } from './types.js';

const UA = 'Mozilla/5.0 (compatible; SINDAR/0.1; +https://github.com/djoeekoe-netizen/SINDAR)';

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
    'Fetch a public web page (or JSON/text URL) and return readable text. Not for private/local addresses.',
  parameters: z.object({
    url: z.string().url().describe('http(s) URL'),
    max_chars: z
      .number()
      .int()
      .min(500)
      .max(100_000)
      .optional()
      .describe('Trim the result (default 12000)'),
  }),
  summarize: (a) => `fetch ${a.url}`,
  classify: networkRisk,
  async execute(args, ctx) {
    const u = new URL(args.url);
    if (!/^https?:$/.test(u.protocol))
      return { content: 'error: only http(s) URLs are allowed', isError: true };
    if (isPrivateHost(u.hostname))
      return { content: 'error: private/local addresses are blocked', isError: true };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    const onAbort = () => ctl.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(u, {
        headers: { 'user-agent': UA, accept: 'text/html,application/json,text/plain,*/*' },
        redirect: 'follow',
        signal: ctl.signal,
      });
      if (!res.ok) return { content: `error: HTTP ${res.status} ${res.statusText}`, isError: true };
      if (isPrivateHost(new URL(res.url).hostname))
        return { content: 'error: redirect to a private address was blocked', isError: true };
      const type = res.headers.get('content-type') ?? '';
      const raw = await res.text();
      const max = args.max_chars ?? 12_000;
      let body: string;
      let title: string | undefined;
      if (/json/i.test(type)) {
        try {
          body = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          body = raw;
        }
      } else if (/html/i.test(type) || /^\s*<!doctype html|^\s*<html/i.test(raw)) {
        const conv = htmlToText(raw, res.url);
        body = conv.text;
        title = conv.title;
      } else body = raw;
      const trimmed =
        body.length > max ? `${body.slice(0, max)}\n…[trimmed ${body.length - max} chars]` : body;
      return {
        content: `${title ? `# ${title}\n` : ''}URL: ${res.url}\n\n${trimmed}`,
        meta: { url: res.url, title, chars: body.length },
      };
    } catch (err) {
      const msg = ctl.signal.aborted ? 'timeout/cancelled' : (err as Error).message;
      return { content: `error: fetch failed: ${msg}`, isError: true };
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
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
          headers: { 'user-agent': UA, accept: 'text/html' },
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
