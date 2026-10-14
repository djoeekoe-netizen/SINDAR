import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createLogger,
  detectPlatform,
  ensureIdentityFiles,
  loadConfig,
  openDatabase,
  ProviderRegistry,
  createMockProvider,
  registerAssetDir,
  SessionStore,
  toolsForToolsets,
  readEnvFile,
  type AgentRuntime,
} from '@sindar/core';
import {
  chunkHtml,
  createGateway,
  markdownToTelegramHtml,
  type ChannelsDTO,
  type Gateway,
} from '../src/index.js';
import { fakeTelegram, GOOD_TOKEN, waitFor, type FakeTelegram } from './fake-telegram.js';

const here = path.dirname(fileURLToPath(import.meta.url));
registerAssetDir(path.resolve(here, '../../cli/assets'));

async function makeRuntime(): Promise<AgentRuntime & { cleanup(): Promise<void> }> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-tg-'));
  const loaded = await loadConfig({ home, env: {}, init: true });
  const { config, paths } = loaded;
  config.channels.telegram.enabled = true;
  ensureIdentityFiles(paths);
  const { db } = await openDatabase(paths.db, { driver: 'auto' });
  return {
    config,
    paths,
    platform: detectPlatform({}),
    env: { TELEGRAM_BOT_TOKEN: GOOD_TOKEN },
    lang: 'en' as const,
    logger: createLogger({ level: 'error', console: false }),
    registry: new ProviderRegistry(config, {}),
    tools: toolsForToolsets(config.agent.toolsets),
    store: new SessionStore(db),
    db,
    cleanup: async () => {
      await db.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

describe('telegram formatting', () => {
  it('converts markdown to the Telegram HTML subset', () => {
    const html = markdownToTelegramHtml(
      '# عنوان\n\nنص **غامق** و `code` و [رابط](https://x.y/z?a=1&b=2) <tag>\n\n- نقطة\n1. أول\n\n```js\nconst a = 1 < 2;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> اقتباس\n\nfile_name_here and _italic_ here',
    );
    expect(html).toContain('<b>عنوان</b>');
    expect(html).toContain('<b>غامق</b>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://x.y/z?a=1&amp;b=2">رابط</a>');
    expect(html).toContain('&lt;tag&gt;');
    expect(html).toContain('• نقطة');
    expect(html).toContain('1. أول');
    expect(html).toContain('<pre><code class="language-js">const a = 1 &lt; 2;</code></pre>');
    expect(html).toContain('<pre>a │ b\n1 │ 2</pre>');
    expect(html).toContain('<blockquote>اقتباس</blockquote>');
    expect(html).toContain('file_name_here and <i>italic</i> here');
  });

  it('splits long messages at paragraph boundaries and keeps <pre> balanced', () => {
    const para = 'سطر '.repeat(100).trim();
    const html = markdownToTelegramHtml(Array.from({ length: 30 }, () => para).join('\n\n'));
    const chunks = chunkHtml(html, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    expect(chunks.join('\n\n').replace(/\n+/g, '\n')).toBe(html.replace(/\n+/g, '\n'));

    const code = `<pre>${'line\n'.repeat(400)}</pre>`;
    const parts = chunkHtml(code, 1000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.startsWith('<pre>')).toBe(true);
      expect(p.endsWith('</pre>')).toBe(true);
    }
  });
});

describe('telegram channel (fake Bot API + mock provider)', () => {
  let rt: Awaited<ReturnType<typeof makeRuntime>>;
  let gw: Gateway;
  let tg: FakeTelegram;
  const OWNER = 1001;
  const api = (p: string, init: RequestInit = {}) =>
    fetch(`${gw.url}${p}`, {
      ...init,
      headers: {
        authorization: `Bearer ${gw.token}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  const channels = async (): Promise<ChannelsDTO> =>
    (await (await api('/api/channels')).json()) as ChannelsDTO;

  beforeAll(async () => {
    rt = await makeRuntime();
    tg = fakeTelegram();
    gw = await createGateway(rt, {
      host: '127.0.0.1',
      port: 0,
      wakeLock: false,
      telegram: {
        fetch: tg.fetch,
        pollTimeoutS: 1,
        streamIntervalMs: 30,
        typingIntervalMs: 60_000,
      },
    });
    await waitFor(() => gw.telegram()?.status().running, { label: 'telegram running' });
  });
  afterAll(async () => {
    await gw.close();
    await rt.cleanup();
  });

  it('starts polling, registers commands and reports status', async () => {
    const c = await channels();
    expect(c.telegram).toMatchObject({
      enabled: true,
      configured: true,
      running: true,
      bot: { id: 42, username: 'sindar_test_bot' },
    });
    expect(tg.callsOf('deleteWebhook')).toHaveLength(1);
    expect(tg.callsOf('setMyCommands')[0]!.params.commands).toEqual(
      expect.arrayContaining([expect.objectContaining({ command: 'new' })]),
    );
  });

  it('gives unknown chats a pairing code and talks only after the owner approves it', async () => {
    tg.say(OWNER, 'hello?');
    const hint = await waitFor(() => tg.sentTo(OWNER)[0], { label: 'pairing hint' });
    const code = /Pairing code: (\d{6})/.exec(hint.text)?.[1];
    expect(code).toBeDefined();
    // Repeated messages within a minute do not spam another hint.
    tg.say(OWNER, 'anyone?');
    await new Promise((r) => setTimeout(r, 100));
    expect(tg.sentTo(OWNER)).toHaveLength(1);

    let c = await channels();
    expect(c.telegram.pending).toEqual([
      expect.objectContaining({ userId: String(OWNER), code, displayName: 'User1001 (@user1001)' }),
    ]);
    expect(
      (await api('/api/channels/telegram/pairings/000000/approve', { method: 'POST' })).status,
    ).toBe(404);
    const approved = await api(`/api/channels/telegram/pairings/${code}/approve`, {
      method: 'POST',
    });
    expect(approved.status).toBe(200);
    await waitFor(() => tg.sentTo(OWNER).some((m) => m.text.startsWith('✅ Paired')), {
      label: 'paired notice',
    });
    c = await channels();
    expect(c.telegram.pending).toEqual([]);
    expect(c.telegram.approved.map((p) => p.userId)).toEqual([String(OWNER)]);
  });

  it('runs a turn for a paired chat, streams into one message and keeps the session', async () => {
    tg.say(OWNER, 'مرحبا يا سندار');
    const reply = await waitFor(
      () => tg.sentTo(OWNER).find((m) => m.text === 'echo: مرحبا يا سندار'),
      { label: 'final reply' },
    );
    expect(reply.parse_mode).toBe('HTML');
    expect(tg.callsOf('sendChatAction').length).toBeGreaterThan(0);
    // No stray placeholder: the paired notice, then exactly one reply message.
    expect(tg.sentTo(OWNER).map((m) => m.text)).toEqual([
      expect.stringContaining('Pairing code'),
      expect.stringContaining('Paired'),
      'echo: مرحبا يا سندار',
    ]);

    const session = rt.store.last('telegram', String(OWNER));
    expect(session).toBeDefined();
    expect(rt.store.messages(session!.id).map((m) => m.role)).toEqual(['user', 'assistant']);
    // The same session is visible to the web UI.
    const list = (await (await api('/api/sessions')).json()) as { sessions: Array<{ id: string }> };
    expect(list.sessions.some((s) => s.id === session!.id)).toBe(true);

    // A second message continues the same session.
    tg.say(OWNER, 'ثانية');
    await waitFor(() => tg.sentTo(OWNER).find((m) => m.text === 'echo: ثانية'), {
      label: 'second',
    });
    expect(rt.store.last('telegram', String(OWNER))!.id).toBe(session!.id);

    // /status and /new
    tg.say(OWNER, '/status');
    const st = await waitFor(() => tg.sentTo(OWNER).find((m) => m.text.startsWith('Model: ')), {
      label: 'status',
    });
    expect(st.text).toContain('mock:echo');
    tg.say(OWNER, '/new');
    await waitFor(() => tg.sentTo(OWNER).find((m) => m.text.startsWith('🆕')), { label: 'new' });
    tg.say(OWNER, 'ثالثة');
    await waitFor(() => tg.sentTo(OWNER).find((m) => m.text === 'echo: ثالثة'), { label: 'third' });
    expect(rt.store.last('telegram', String(OWNER))!.id).not.toBe(session!.id);
  });

  it('streams a slow answer by editing one message, then finalizes it as HTML', async () => {
    const slow = createMockProvider({ delayMs: 25, chunkSize: 4 });
    const original = rt.registry;
    rt.registry = new ProviderRegistry(rt.config, {}, { instances: { mock: slow } });
    try {
      tg.say(OWNER, 'stream **this** please');
      const placeholder = await waitFor(
        () => tg.sentTo(OWNER).find((m) => m.text.endsWith(' ▍') || m.text === '⏳ …'),
        { label: 'streaming placeholder' },
      );
      const final = await waitFor(
        () => tg.sentTo(OWNER).find((m) => m.text === 'echo: stream <b>this</b> please'),
        { label: 'final html' },
      );
      expect(final.message_id).toBe(placeholder.message_id);
      expect(final.edits).toBeGreaterThanOrEqual(2);
      expect(final.parse_mode).toBe('HTML');
    } finally {
      rt.registry = original;
    }
  });

  it('asks for approval with inline buttons and continues when tapped', async () => {
    tg.say(OWNER, '!tool terminal {"command":"echo tg-ok"}');
    const ask = await waitFor(
      () => tg.sentTo(OWNER).find((m) => m.reply_markup?.inline_keyboard.length),
      {
        label: 'approval message',
      },
    );
    expect(ask.text).toContain('I need your approval');
    const allow = ask.reply_markup!.inline_keyboard[0]![0]!;
    expect(allow.text).toBe('✅ Allow');
    expect(allow.callback_data).toMatch(/^apr:[\w-]+:allow$/);
    // The web UI sees the same pending approval.
    const status = (await (await api('/api/status')).json()) as { pending: Array<{ id: string }> };
    expect(status.pending).toHaveLength(1);
    expect(allow.callback_data).toContain(status.pending[0]!.id);

    tg.tap(OWNER, ask.message_id, allow.callback_data!);
    await waitFor(
      () =>
        tg
          .sentTo(OWNER)
          .find((m) => m.text.includes('tool-result:terminal') && m.text.includes('tg-ok')),
      {
        label: 'tool result reply',
      },
    );
    const resolved = tg.messages.get(ask.message_id)!;
    expect(resolved.text).toMatch(/^✅ Approved: /);
    expect(resolved.reply_markup?.inline_keyboard).toEqual([]);
    expect(tg.callsOf('answerCallbackQuery')).toHaveLength(1);
  });

  it('sends files produced by tools (make_pdf) as documents', async () => {
    tg.say(OWNER, '!tool make_pdf {"path":"tg-report","content":"# مرحبا\\n\\nمن تيليجرام"}');
    const doc = await waitFor(() => tg.documents.find((d) => d.name === 'tg-report.pdf'), {
      label: 'document',
      timeoutMs: 10_000,
    });
    expect(doc.chat_id).toBe(OWNER);
    expect(doc.size).toBeGreaterThan(1000);
    expect(fs.existsSync(path.join(rt.paths.workspace, 'tg-report.pdf'))).toBe(true);
  });

  it('ignores strangers in groups, answers mentions in approved groups, and revokes', async () => {
    const GROUP = -5001;
    tg.say(GROUP, 'random chatter');
    await new Promise((r) => setTimeout(r, 120));
    expect(tg.sentTo(GROUP)).toHaveLength(0);
    tg.say(GROUP, '/start@sindar_test_bot');
    const hint = await waitFor(() => tg.sentTo(GROUP)[0], { label: 'group pairing hint' });
    const code = /Pairing code: (\d{6})/.exec(hint.text)![1]!;
    await api(`/api/channels/telegram/pairings/${code}/approve`, { method: 'POST' });
    await waitFor(() => tg.sentTo(GROUP).some((m) => m.text.startsWith('✅ Paired')));
    tg.say(GROUP, 'not for the bot');
    await new Promise((r) => setTimeout(r, 120));
    expect(tg.sentTo(GROUP).some((m) => m.text.startsWith('echo:'))).toBe(false);
    tg.say(GROUP, '@sindar_test_bot ping');
    await waitFor(() => tg.sentTo(GROUP).find((m) => m.text === 'echo: ping'), {
      label: 'group echo',
    });

    const del = await api(`/api/channels/telegram/pairings/${GROUP}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    await waitFor(() =>
      tg.sentTo(GROUP).some((m) => m.text.startsWith('🔒 This chat has been unpaired')),
    );
    expect((await channels()).telegram.approved.map((p) => p.userId)).toEqual([String(OWNER)]);
  });

  it('can be switched off and on through the config API and validates new tokens', async () => {
    const off = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ 'channels.telegram.enabled': false }),
    });
    expect(off.status).toBe(200);
    expect((await channels()).telegram.running).toBe(false);
    expect(fs.readFileSync(rt.paths.config, 'utf8')).toMatch(/enabled: false/);

    const bad = await api('/api/channels/telegram/token', {
      method: 'POST',
      body: JSON.stringify({ token: 'nope' }),
    });
    expect(bad.status).toBe(400);
    const rejected = await api('/api/channels/telegram/token', {
      method: 'POST',
      body: JSON.stringify({ token: `999:${'b'.repeat(35)}` }),
    });
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as { error: string }).error).toMatch(/Unauthorized/);

    const good = await api('/api/channels/telegram/token', {
      method: 'POST',
      body: JSON.stringify({ token: GOOD_TOKEN }),
    });
    expect(good.status).toBe(200);
    expect(readEnvFile(rt.paths.env).TELEGRAM_BOT_TOKEN).toBe(GOOD_TOKEN);
    expect(rt.config.channels.telegram.enabled).toBe(true);
    await waitFor(() => gw.telegram()?.status().running, { label: 'running again' });
    tg.say(OWNER, 'back');
    await waitFor(() => tg.sentTo(OWNER).find((m) => m.text === 'echo: back'), {
      label: 'after restart',
    });
  });
});
