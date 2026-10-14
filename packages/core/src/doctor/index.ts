import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ConfigError, type LoadedConfig } from '../config/load.js';
import type { Lang } from '../config/schema.js';
import { openDatabase, detectDriver } from '../db/open.js';
import { ftsKind } from '../db/migrations.js';
import { t } from '../i18n/index.js';
import { commandExists, detectPlatform, formatBytes, type PlatformInfo } from '../platform.js';
import { resolveProviders, type ResolvedProvider } from '../providers/resolve.js';
import { parseModelRef } from '../providers/model-ref.js';
import { BUILD, MIN_NODE, VERSION, nodeVersionOk } from '../version.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';

/** Two build ids (git SHAs, possibly abbreviated) refer to the same commit. */
export function sameBuild(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const n = Math.min(a.length, b.length, 40);
  return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}

export interface CheckResult {
  id: string;
  status: CheckStatus;
  title: string;
  hint?: string;
  /** Sub-lines (e.g. one per provider). */
  items?: Array<{ status: CheckStatus; text: string }>;
}

export interface DoctorReport {
  version: string;
  build: string;
  lang: Lang;
  platform: PlatformInfo;
  home?: string;
  checks: CheckResult[];
  summary: { ok: number; warn: number; fail: number; info: number };
  /** Human headline, localised. */
  verdict: string;
}

export interface DoctorOptions {
  home?: string;
  lang?: Lang;
  env?: Record<string, string | undefined>;
  /** Probe local servers (Ollama etc.) over HTTP. Default true. */
  probeLocal?: boolean;
  probeTimeoutMs?: number;
  /** Check whether the local gateway (brain) is running and on this build. Default true. */
  probeGateway?: boolean;
}

async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function diskFree(dir: string): Promise<number | undefined> {
  try {
    const s = await fs.promises.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return undefined;
  }
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const env = opts.env ?? process.env;
  const platform = detectPlatform(env);
  const checks: CheckResult[] = [];
  let lang: Lang = opts.lang ?? 'ar';
  const probeTimeout = opts.probeTimeoutMs ?? 1500;

  // 1. Node
  const nodeOk = nodeVersionOk(platform.nodeVersion);
  checks.push({
    id: 'node',
    status: nodeOk ? 'ok' : 'fail',
    title: '', // filled after lang is final
  });

  // 2. Config / home
  let loaded: LoadedConfig | undefined;
  let configError: string | undefined;
  try {
    loaded = await loadConfig({ home: opts.home, env });
    if (!opts.lang) lang = loaded.config.ui.language;
  } catch (err) {
    configError =
      err instanceof ConfigError ? [err.message, ...err.issues].join('; ') : (err as Error).message;
  }

  const T = (key: Parameters<typeof t>[1], vars?: Parameters<typeof t>[2]) => t(lang, key, vars);

  checks[0] = {
    id: 'node',
    status: nodeOk ? 'ok' : 'fail',
    title: nodeOk
      ? T('doctor.node.ok', { version: platform.nodeVersion })
      : T('doctor.node.fail', {
          version: platform.nodeVersion,
          min: `${MIN_NODE.major}.${MIN_NODE.minor}`,
        }),
    hint: nodeOk
      ? undefined
      : platform.isTermux
        ? T('doctor.node.hint.termux')
        : T('doctor.node.hint'),
  };

  checks.push({
    id: 'platform',
    status: 'info',
    title: platform.isTermux
      ? T('doctor.platform.termux', {
          version: platform.termuxVersion ?? '?',
          arch: platform.arch,
          shell: path.basename(platform.shell),
        })
      : T('doctor.platform', {
          os: platform.os,
          arch: platform.arch,
          shell: path.basename(platform.shell),
        }),
  });

  if (loaded) {
    const createdHome = loaded.created.includes(loaded.paths.home);
    checks.push({
      id: 'home',
      status: 'ok',
      title: createdHome
        ? T('doctor.home.created', { home: loaded.paths.home })
        : T('doctor.home.ok', { home: loaded.paths.home }),
    });
    const model = loaded.config.model.default;
    checks.push({ id: 'config', status: 'ok', title: T('doctor.config.ok', { model }) });
    for (const w of loaded.warnings)
      checks.push({
        id: 'config.warn',
        status: 'warn',
        title: T('doctor.config.warn', { warning: w }),
      });
    if (parseModelRef(model).provider === 'mock')
      checks.push({ id: 'model', status: 'warn', title: T('doctor.model.mock') });
    const tg = loaded.config.channels.telegram;
    if (tg.enabled) {
      const hasToken = Boolean(loaded.env[tg.tokenEnv] ?? env[tg.tokenEnv]);
      checks.push({
        id: 'telegram',
        status: hasToken ? 'ok' : 'warn',
        title: hasToken
          ? T('doctor.telegram.ok', { env: tg.tokenEnv })
          : T('doctor.telegram.notoken', { env: tg.tokenEnv }),
      });
    } else {
      checks.push({ id: 'telegram', status: 'info', title: T('doctor.telegram.off') });
    }
  } else {
    checks.push({
      id: 'config',
      status: 'fail',
      title: T('doctor.config.fail', { error: configError ?? '?' }),
    });
  }

  // 3. Database
  if (loaded) {
    try {
      const driver = await detectDriver();
      const { db, migration } = await openDatabase(loaded.paths.db);
      const fts = ftsKind(db);
      const sqlite = db.sqliteVersion();
      await db.close();
      checks.push({
        id: 'db',
        status: 'ok',
        title: T('doctor.db.ok', {
          driver,
          sqlite,
          fts: fts === 'none' ? '✖' : fts.toUpperCase(),
          schema: migration?.current ?? 0,
        }),
      });
      if (driver === 'sql.js')
        checks.push({ id: 'db.fallback', status: 'info', title: T('doctor.db.fallback') });
      if (fts === 'none')
        checks.push({ id: 'db.fts', status: 'warn', title: T('doctor.db.fts.missing') });
    } catch (err) {
      checks.push({
        id: 'db',
        status: 'fail',
        title: T('doctor.db.fail', { error: (err as Error).message }),
      });
    }
  }

  // 4. Providers
  if (loaded) {
    const providers = resolveProviders(loaded.config, loaded.env).filter(
      (p) => p.enabled && p.kind !== 'mock',
    );
    const items: NonNullable<CheckResult['items']> = [];
    let anyReady = false;
    const describeFree = (p: ResolvedProvider) =>
      p.free === 'local'
        ? T('doctor.free.local')
        : p.free === 'free-tier'
          ? T('doctor.free.free-tier', { url: p.signupUrl ?? '' })
          : T('doctor.free.paid');

    for (const p of providers) {
      if (!p.requiresKey && p.baseUrl) {
        const url = p.baseUrl.replace(/\/v1\/?$/, '');
        const up =
          opts.probeLocal === false ? false : await probeUrl(`${url}/v1/models`, probeTimeout);
        if (up) anyReady = true;
        if (up || p.id === 'ollama') {
          items.push({
            status: up ? 'ok' : 'info',
            text: up
              ? T('doctor.provider.local.ok', { name: p.name, url })
              : T('doctor.provider.local.down', { name: p.name, url }),
          });
        }
        continue;
      }
      if (p.configured) {
        anyReady = true;
        items.push({ status: 'ok', text: T('doctor.provider.ready', { name: p.name }) });
      } else if (p.free === 'free-tier') {
        items.push({
          status: 'info',
          text: T('doctor.provider.nokey', {
            name: p.name,
            env: p.apiKeyEnv ?? 'API key',
            free: describeFree(p),
          }),
        });
      }
    }
    checks.push({
      id: 'providers',
      status: anyReady ? 'ok' : 'warn',
      title: anyReady ? T('doctor.providers.title') : T('doctor.providers.none'),
      items,
    });
  }

  // 5. Termux specifics
  if (platform.isTermux) {
    const items: NonNullable<CheckResult['items']> = [];
    const wake = commandExists('termux-wake-lock', env);
    items.push({
      status: wake ? 'ok' : 'warn',
      text: wake ? T('doctor.termux.wakelock.ok') : T('doctor.termux.wakelock.missing'),
    });
    const api = commandExists('termux-notification', env);
    items.push({
      status: api ? 'ok' : 'info',
      text: api ? T('doctor.termux.api.ok') : T('doctor.termux.api.missing'),
    });
    const storage = fs.existsSync(path.join(platform.home, 'storage'));
    items.push({
      status: storage ? 'ok' : 'info',
      text: storage ? T('doctor.termux.storage.ok') : T('doctor.termux.storage.missing'),
    });
    items.push({ status: 'info', text: T('doctor.termux.battery') });
    checks.push({
      id: 'termux',
      status: wake ? 'ok' : 'warn',
      title: T('doctor.termux.title'),
      items,
    });
  }

  // 6. The brain (gateway): running? and on the same build as this CLI?
  if (loaded && opts.probeGateway !== false) {
    const g = loaded.config.gateway;
    const host = g.host === '0.0.0.0' || g.host === '::' ? '127.0.0.1' : g.host;
    const url = `http://${host}:${g.port}`;
    let health: { version?: string; build?: string } | undefined;
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(probeTimeout) });
      if (res.ok) health = (await res.json()) as { version?: string; build?: string };
    } catch {
      /* not running */
    }
    if (!health) {
      checks.push({ id: 'gateway', status: 'info', title: T('doctor.gateway.down') });
    } else {
      const build = (health.build ?? '?').slice(0, 7);
      const same = sameBuild(health.build, BUILD);
      checks.push({
        id: 'gateway',
        status: same ? 'ok' : 'warn',
        title: same
          ? T('doctor.gateway.ok', { url, build })
          : T('doctor.gateway.stale', { url, build, installed: BUILD.slice(0, 7) }),
        hint: same ? undefined : T('doctor.gateway.stale.hint'),
      });
    }
  }

  // 7. Resources
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const free = await diskFree(loaded?.paths.home ?? platform.home);
  checks.push({
    id: 'resources',
    status: 'info',
    title: T('doctor.resources', {
      freeMem: formatBytes(freeMem),
      totalMem: formatBytes(totalMem),
      freeDisk: free === undefined ? '?' : formatBytes(free),
    }),
  });
  if (freeMem < 1.5 * 1024 ** 3)
    checks.push({
      id: 'resources.lowmem',
      status: 'warn',
      title: T('doctor.resources.lowmem', { freeMem: formatBytes(freeMem) }),
    });

  const summary = { ok: 0, warn: 0, fail: 0, info: 0 };
  for (const c of checks) summary[c.status]++;
  const verdict =
    summary.fail > 0
      ? T('doctor.summary.fail', { n: summary.fail })
      : summary.warn > 0
        ? T('doctor.summary.warn', { n: summary.warn })
        : T('doctor.summary.ok');

  return {
    version: VERSION,
    build: BUILD,
    lang,
    platform,
    home: loaded?.paths.home,
    checks,
    summary,
    verdict,
  };
}
