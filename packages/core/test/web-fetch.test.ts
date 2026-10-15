import { describe, expect, it } from 'vitest';
import {
  browserHeaders,
  fetchReadable,
  looksLikeBlockPage,
  parseReaderEnvelope,
} from '../src/tools/web.js';

type Route = (init?: RequestInit) => Response | Promise<Response>;

/** A fake `fetch` keyed by URL prefix; records every request. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; ua?: string }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, ua: (init?.headers as Record<string, string> | undefined)?.['user-agent'] });
    for (const [prefix, route] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return route(init);
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const html = (title: string, body: string) =>
  new Response(`<html><head><title>${title}</title></head><body>${body}</body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

const ARTICLE = 'https://news.example/tech/ai';
const READER = 'https://reader.test/';
const WAYBACK = 'https://archive.test/available?url=';

describe('web_fetch resilience', () => {
  it('sends browser-grade headers in the requested language', () => {
    const h = browserHeaders('ar');
    expect(h['user-agent']).toContain('Chrome/');
    expect(h['accept-language']).toMatch(/^ar,/);
    expect(h['sec-fetch-mode']).toBe('navigate');
    expect(browserHeaders('en')['accept-language']).toMatch(/^en-US/);
  });

  it('reads the page directly when the site is friendly', async () => {
    const { f, calls } = fakeFetch({ [ARTICLE]: () => html('Hello', '<p>Body text</p>') });
    const r = await fetchReadable(ARTICLE, { fetch: f, readerProxy: READER, waybackApi: WAYBACK });
    expect(r.via).toBe('direct');
    expect(r.title).toBe('Hello');
    expect(r.text).toContain('Body text');
    expect(calls).toHaveLength(1);
  });

  it('retries with a desktop UA, then the reader proxy, when the site answers 403', async () => {
    const notes: string[] = [];
    const { f, calls } = fakeFetch({
      [ARTICLE]: (init) =>
        /Windows/.test((init?.headers as Record<string, string>)['user-agent'] ?? '')
          ? html('Desktop OK', '<p>Served to desktop</p>')
          : new Response('<h1>ACCESS DENIED</h1>', { status: 403, statusText: 'Forbidden' }),
    });
    const r = await fetchReadable(ARTICLE, {
      fetch: f,
      readerProxy: READER,
      waybackApi: WAYBACK,
      onProgress: (l) => notes.push(l),
    });
    expect(r.via).toBe('desktop-ua');
    expect(r.text).toContain('Served to desktop');
    expect(calls.map((c) => c.url)).toEqual([ARTICLE, ARTICLE]);
    expect(notes).toHaveLength(0);
  });

  it('falls back to the reader proxy (parsing its envelope) when both direct attempts are blocked', async () => {
    const notes: string[] = [];
    const { f, calls } = fakeFetch({
      [ARTICLE]: () => new Response('blocked', { status: 403 }),
      [READER]: () =>
        new Response(
          `Title: أهم أخبار الذكاء الاصطناعي\nURL Source: ${ARTICLE}\n\nMarkdown Content:\n## عنوان\nنص المقال هنا.`,
          { status: 200 },
        ),
    });
    const r = await fetchReadable(ARTICLE, {
      fetch: f,
      lang: 'ar',
      readerProxy: READER,
      waybackApi: WAYBACK,
      onProgress: (l) => notes.push(l),
    });
    expect(r.via).toBe('reader');
    expect(r.title).toBe('أهم أخبار الذكاء الاصطناعي');
    expect(r.text).toBe('## عنوان\nنص المقال هنا.');
    expect(calls[2]!.url).toBe(`${READER}${ARTICLE}`);
    expect(notes[0]).toContain('قارئ');
  });

  it('treats a reader proxy that relays the target 403 as a failure and uses the archive', async () => {
    const { f, calls } = fakeFetch({
      [ARTICLE]: () => new Response('blocked', { status: 403 }),
      [READER]: () =>
        new Response(
          `Title: تم رفض الوصول\nURL Source: ${ARTICLE}\n\nWarning: Target URL returned error 403: Forbidden\n\nMarkdown Content:\n## ACCESS DENIED\nYour request has been blocked for security reasons.`,
        ),
      [WAYBACK]: () =>
        Response.json({
          archived_snapshots: {
            closest: {
              available: true,
              url: `http://web.archive.org/web/20261001120000/${ARTICLE}`,
              timestamp: '20261001120000',
            },
          },
        }),
      ['http://web.archive.org/web/20261001120000id_/']: () =>
        html('Archived article', '<p>Old but readable</p>'),
    });
    const r = await fetchReadable(ARTICLE, { fetch: f, readerProxy: READER, waybackApi: WAYBACK });
    expect(r.via).toBe('archive');
    expect(r.note).toContain('2026-10-01');
    expect(r.text).toContain('Old but readable');
    expect(calls.at(-1)!.url).toBe(`http://web.archive.org/web/20261001120000id_/${ARTICLE}`);
  });

  it('recognises a 200 "bot wall" page and explains clearly when every route fails', async () => {
    expect(looksLikeBlockPage('Just a moment... Checking your browser before accessing')).toBe(
      true,
    );
    expect(looksLikeBlockPage('## تم رفض الوصول\nتم حظر طلبك لأسباب أمنية.')).toBe(true);
    expect(looksLikeBlockPage('A normal article about captcha research '.repeat(600))).toBe(false);
    const { f } = fakeFetch({
      [ARTICLE]: () => html('Access Denied', '<h1>Access Denied</h1><p>Request blocked.</p>'),
      [READER]: () => new Response('rate limited', { status: 429 }),
      [WAYBACK]: () => Response.json({ archived_snapshots: {} }),
    });
    await expect(
      fetchReadable(ARTICLE, { fetch: f, readerProxy: READER, waybackApi: WAYBACK }),
    ).rejects.toThrow(
      /blocks automated readers.*reader proxy HTTP 429.*no archived copy.*paste the text/s,
    );
  });

  it('does not use fallbacks for ordinary 404s and respects disabled fallbacks', async () => {
    const { f, calls } = fakeFetch({ [ARTICLE]: () => new Response('gone', { status: 404 }) });
    await expect(
      fetchReadable(ARTICLE, { fetch: f, readerProxy: READER, waybackApi: WAYBACK }),
    ).rejects.toThrow(/HTTP 404/);
    expect(calls).toHaveLength(1);
    const blocked = fakeFetch({ [ARTICLE]: () => new Response('no', { status: 403 }) });
    await expect(
      fetchReadable(ARTICLE, { fetch: blocked.f, readerProxy: false, waybackApi: false }),
    ).rejects.toThrow(/HTTP 403/);
    expect(blocked.calls).toHaveLength(2); // mobile + desktop UA only
  });

  it('parses reader envelopes defensively', () => {
    expect(parseReaderEnvelope('')).toBeUndefined();
    expect(parseReaderEnvelope('Markdown Content:\n')).toBeUndefined();
    expect(parseReaderEnvelope('just text')).toEqual({
      title: undefined,
      text: 'just text',
      targetError: undefined,
    });
  });
});
