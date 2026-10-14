import type { Command } from 'commander';
import pc from 'picocolors';
import { PairingStore, setConfigValue, t, upsertEnvVar } from '@sindar/core';
import {
  loadOrCreateToken,
  TelegramApi,
  TELEGRAM_CHANNEL,
  type ChannelsDTO,
  type PairingDTO,
} from '@sindar/gateway';
import { bootstrap, type App } from '../app.js';
import { createPrompter, type Prompter } from '../ui/prompt.js';
import { ensureGatewayRunning, fetchHealth, gatewayUrl } from './gateway.js';

const TOKEN_RE = /^\d+:[\w-]{30,}$/;

interface GatewayClient {
  url: string;
  token: string;
  json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }>;
}

/** REST client for the running gateway, or undefined when it is not up. */
async function gatewayClient(app: App): Promise<GatewayClient | undefined> {
  const url = gatewayUrl(app);
  if (!(await fetchHealth(url))) return undefined;
  const token = process.env.SINDAR_GATEWAY_TOKEN ?? loadOrCreateToken(app.paths.home);
  return {
    url,
    token,
    async json<T>(p: string, init: RequestInit = {}) {
      const res = await fetch(`${url}${p}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
    },
  };
}

const out = (s = '') => process.stdout.write(`${s}\n`);
const fail = (s: string) => {
  process.stderr.write(`${pc.red(s)}\n`);
  process.exitCode = 1;
};

function describePairing(p: PairingDTO | { userId: string; displayName: string | null }): string {
  return `${p.displayName ?? '?'} [${p.userId}]`;
}

export async function telegramStatus(app: App): Promise<void> {
  const lang = app.lang;
  const cfg = app.config.channels.telegram;
  const gw = await gatewayClient(app);
  const hasToken = Boolean(app.env[cfg.tokenEnv]);
  if (!gw) {
    const store = new PairingStore(app.db);
    out(pc.dim(t(lang, 'tgcli.status.offline')));
    out(
      t(lang, 'tgcli.status', {
        state: cfg.enabled ? t(lang, 'tgcli.status.stopped') : t(lang, 'tgcli.status.disabled'),
        bot: '—',
        token: hasToken
          ? t(lang, 'tgcli.token.present', { env: cfg.tokenEnv })
          : t(lang, 'tgcli.token.missing'),
        approved: store.list(TELEGRAM_CHANNEL, 'approved').length,
        pending: store.pending(TELEGRAM_CHANNEL).length,
      }),
    );
    return;
  }
  const { body } = await gw.json<ChannelsDTO>('/api/channels');
  const tg = body.telegram;
  const state = !tg.enabled
    ? t(lang, 'tgcli.status.disabled')
    : tg.running
      ? t(lang, 'tgcli.status.running')
      : t(lang, 'tgcli.status.stopped');
  out(
    t(lang, 'tgcli.status', {
      state,
      bot: tg.bot ? `@${tg.bot.username}` : '—',
      token: tg.configured
        ? t(lang, 'tgcli.token.present', { env: tg.tokenEnv })
        : t(lang, 'tgcli.token.missing'),
      approved: tg.approved.length,
      pending: tg.pending.length,
    }),
  );
  if (tg.lastError && !tg.running)
    out(pc.yellow(t(lang, 'tgcli.status.error', { error: tg.lastError })));
  if (tg.pending.length) {
    out(t(lang, 'tgcli.pending.title'));
    for (const p of tg.pending) out(`  ${p.code}  ${describePairing(p)}`);
  }
}

async function approve(app: App, code: string): Promise<void> {
  const lang = app.lang;
  const gw = await gatewayClient(app);
  if (gw) {
    const r = await gw.json<{ pairing?: PairingDTO; error?: string }>(
      `/api/channels/telegram/pairings/${encodeURIComponent(code)}/approve`,
      { method: 'POST' },
    );
    if (r.status === 200 && r.body.pairing)
      out(pc.green(t(lang, 'tgcli.approve.ok', { name: describePairing(r.body.pairing) })));
    else fail(t(lang, 'tgcli.approve.unknown'));
    return;
  }
  const store = new PairingStore(app.db);
  const p = store.approve(TELEGRAM_CHANNEL, code);
  if (p) out(pc.green(t(lang, 'tgcli.approve.ok', { name: describePairing(p) })));
  else fail(t(lang, 'tgcli.approve.unknown'));
}

async function revoke(app: App, id: string): Promise<void> {
  const lang = app.lang;
  const gw = await gatewayClient(app);
  const ok = gw
    ? (
        await gw.json(`/api/channels/telegram/pairings/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
      ).status === 200
    : new PairingStore(app.db).revoke(TELEGRAM_CHANNEL, id);
  if (ok) out(t(lang, 'tgcli.revoke.ok', { id }));
  else fail(t(lang, 'tgcli.revoke.unknown'));
}

async function listPairings(app: App): Promise<void> {
  const lang = app.lang;
  const gw = await gatewayClient(app);
  let pending: Array<{ userId: string; displayName: string | null; code: string | null }>;
  let approved: Array<{ userId: string; displayName: string | null }>;
  if (gw) {
    const { body } = await gw.json<ChannelsDTO>('/api/channels');
    pending = body.telegram.pending;
    approved = body.telegram.approved;
  } else {
    const store = new PairingStore(app.db);
    pending = store.pending(TELEGRAM_CHANNEL);
    approved = store.list(TELEGRAM_CHANNEL, 'approved');
  }
  if (pending.length) {
    out(t(lang, 'tgcli.pending.title'));
    for (const p of pending) out(`  ${p.code}  ${describePairing(p)}`);
  } else out(pc.dim(t(lang, 'tgcli.pending.none')));
  if (approved.length) {
    out(t(lang, 'tgcli.approved.title'));
    for (const p of approved) out(`  ${describePairing(p)}`);
  }
}

/** Interactive setup: BotFather steps → token → validate → save → start → wait for /start → approve. */
export async function telegramSetup(
  app: App,
  p: Prompter,
  opts: { token?: string; wait?: boolean },
): Promise<number> {
  const lang = app.lang;
  const cfg = app.config.channels.telegram;
  out(pc.bold(t(lang, 'tgcli.title')));
  out();
  let token = (opts.token ?? '').trim();
  if (!token) {
    out(t(lang, 'tgcli.steps'));
    out();
    token = (await p.ask(t(lang, 'tgcli.token.prompt'))).trim();
  }
  token = token.replace(/[^\x21-\x7e]/g, '');
  if (!TOKEN_RE.test(token)) {
    fail(t(lang, 'tgcli.token.invalid'));
    return 1;
  }

  out(pc.dim(t(lang, 'tgcli.token.checking')));
  let gw = await gatewayClient(app);
  let username = '';
  if (gw) {
    const r = await gw.json<{ error?: string; channels?: ChannelsDTO }>(
      '/api/channels/telegram/token',
      { method: 'POST', body: JSON.stringify({ token }) },
    );
    if (r.status !== 200) {
      fail(t(lang, 'tgcli.token.rejected', { error: r.body.error ?? `HTTP ${r.status}` }));
      return 1;
    }
    username = r.body.channels?.telegram.bot?.username ?? '';
  } else {
    try {
      const me = await new TelegramApi(token).getMe();
      username = me.username ?? '';
    } catch (err) {
      fail(t(lang, 'tgcli.token.rejected', { error: (err as Error).message }));
      return 1;
    }
    upsertEnvVar(app.paths.env, cfg.tokenEnv, token);
    app.env[cfg.tokenEnv] = token;
    setConfigValue(app.paths.config, 'channels.telegram.enabled', true);
    app.config.channels.telegram.enabled = true;
  }
  out(pc.green(t(lang, 'tgcli.token.ok', { username })));
  out(t(lang, 'tgcli.saved', { env: app.paths.env }));

  if (!gw) {
    out(pc.dim(t(lang, 'tgcli.gateway.starting')));
    try {
      await ensureGatewayRunning(app, { quiet: true });
    } catch (err) {
      fail((err as Error).message);
      return 1;
    }
    gw = await gatewayClient(app);
    if (!gw) {
      fail(t(lang, 'tgcli.gateway.needed'));
      return 1;
    }
  }

  // Wait for the owner's /start and approve it (confirming the name first).
  out();
  out(pc.bold(t(lang, 'tgcli.pair.now', { username: username || 'your_bot' })));
  if (opts.wait === false || !process.stdin.isTTY) return 0;
  const deadline = Date.now() + 120_000;
  const seen = new Set<string>();
  while (Date.now() < deadline) {
    const { body } = await gw.json<ChannelsDTO>('/api/channels');
    const fresh = body.telegram.pending.filter((x) => !seen.has(x.userId));
    for (const req of fresh) {
      seen.add(req.userId);
      const yes = await p.confirm(
        t(lang, 'tgcli.pair.request', { name: describePairing(req), code: req.code ?? '' }),
        true,
      );
      if (!yes) continue;
      const r = await gw.json<{ pairing?: PairingDTO }>(
        `/api/channels/telegram/pairings/${req.code}/approve`,
        { method: 'POST' },
      );
      if (r.status === 200) {
        out(pc.green(t(lang, 'tgcli.pair.approved')));
        return 0;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  out(pc.yellow(t(lang, 'tgcli.pair.timeout')));
  return 0;
}

async function setFlag(app: App, key: 'enabled' | 'streaming' | 'groups', value: unknown) {
  const dot = `channels.telegram.${key}`;
  const gw = await gatewayClient(app);
  if (gw) {
    const r = await gw.json<{ error?: string }>('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ [dot]: value }),
    });
    if (r.status !== 200) {
      fail(r.body.error ?? `HTTP ${r.status}`);
      return;
    }
  } else setConfigValue(app.paths.config, dot, value);
  out(t(app.lang, 'tgcli.set.ok', { key: dot, value: String(value) }));
}

export function registerTelegram(program: Command): void {
  const withApp = async (cmd: Command, fn: (app: App) => Promise<void>) => {
    const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
    const app = await bootstrap({ home: g.home, lang: g.lang });
    try {
      await fn(app);
    } catch (err) {
      fail((err as Error).message);
    } finally {
      await app.close();
    }
  };

  const tg = program
    .command('telegram')
    .alias('tg')
    .description('talk to SINDAR from Telegram: setup, pairing, status / قناة تيليجرام')
    .action(async (_o: unknown, cmd: Command) => withApp(cmd, telegramStatus));

  tg.command('setup')
    .description('create a bot with @BotFather, save its token and pair your account')
    .option('--token <token>', 'bot token (skips the prompt)')
    .option('--no-wait', 'do not wait for the pairing request')
    .action(async (opts: { token?: string; wait?: boolean }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      const prompter = createPrompter();
      try {
        process.exitCode = await telegramSetup(app, prompter, opts);
      } catch (err) {
        fail((err as Error).message);
      } finally {
        prompter.close();
        await app.close();
      }
    });

  tg.command('status')
    .description('bot, polling state and pairings')
    .action(async (_o: unknown, cmd: Command) => withApp(cmd, telegramStatus));

  tg.command('approve <code>')
    .description('approve a pairing code shown by the bot')
    .action(async (code: string, _o: unknown, cmd: Command) =>
      withApp(cmd, (app) => approve(app, code)),
    );

  tg.command('revoke <chatId>')
    .description('remove a paired chat')
    .action(async (id: string, _o: unknown, cmd: Command) =>
      withApp(cmd, (app) => revoke(app, id)),
    );

  tg.command('pending')
    .alias('list')
    .description('pending requests and paired chats')
    .action(async (_o: unknown, cmd: Command) => withApp(cmd, listPairings));

  tg.command('on')
    .description('enable the channel')
    .action(async (_o: unknown, cmd: Command) =>
      withApp(cmd, (app) => setFlag(app, 'enabled', true)),
    );
  tg.command('off')
    .description('disable the channel')
    .action(async (_o: unknown, cmd: Command) =>
      withApp(cmd, (app) => setFlag(app, 'enabled', false)),
    );
  tg.command('set <key> <value>')
    .description('streaming on|off · groups mention|all|off')
    .action(async (key: string, value: string, _o: unknown, cmd: Command) =>
      withApp(cmd, async (app) => {
        if (key === 'streaming')
          return setFlag(app, 'streaming', value !== 'off' && value !== 'false');
        if (key === 'groups' && ['mention', 'all', 'off'].includes(value))
          return setFlag(app, 'groups', value);
        fail(`unknown setting: ${key} (streaming | groups)`);
      }),
    );
}
