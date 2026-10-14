import type { Command } from 'commander';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { t, type Lang } from '@sindar/core';
import { createGateway, loadOrCreateToken, rotateToken, type HealthDTO } from '@sindar/gateway';
import { bootstrap, type App } from '../app.js';

interface GatewayFiles {
  pid: string;
  log: string;
}

export function gatewayFiles(home: string, logs: string): GatewayFiles {
  return { pid: path.join(home, 'gateway.pid'), log: path.join(logs, 'gateway.log') };
}

/** Where the built web UI lives relative to the CLI bundle (packages/cli/ui). */
export function defaultUiDir(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, '..', 'ui'), path.join(here, '..', '..', 'ui')]) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return undefined;
}

function readPid(file: string): number | undefined {
  try {
    const n = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function fetchHealth(url: string, timeoutMs = 1500): Promise<HealthDTO | undefined> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as HealthDTO;
    return body?.name === 'sindar' ? body : undefined;
  } catch {
    return undefined;
  }
}

export function gatewayUrl(app: App, host?: string, port?: number): string {
  const h = host ?? app.config.gateway.host;
  const p = port ?? app.config.gateway.port;
  return `http://${h === '0.0.0.0' || h === '::' ? '127.0.0.1' : h}:${p}`;
}

/** First non-internal IPv4 address (for QR codes when the gateway listens on 0.0.0.0). */
export function lanAddress(): string | undefined {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return undefined;
}

export function dashboardUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/?token=${encodeURIComponent(token)}`;
}

/** Try to open a URL in the user's browser (Termux, Linux, macOS, Windows). Never throws. */
export function openInBrowser(url: string, isTermux: boolean): Promise<boolean> {
  const attempts: Array<[string, string[]]> = isTermux
    ? [
        ['termux-open-url', [url]],
        ['xdg-open', [url]],
      ]
    : process.platform === 'darwin'
      ? [['open', [url]]]
      : process.platform === 'win32'
        ? [['cmd', ['/c', 'start', '', url]]]
        : [
            ['xdg-open', [url]],
            ['sensible-browser', [url]],
          ];
  return new Promise((resolve) => {
    const tryNext = (i: number) => {
      const a = attempts[i];
      if (!a) return resolve(false);
      execFile(a[0], a[1], { timeout: 5000 }, (err) => (err ? tryNext(i + 1) : resolve(true)));
    };
    tryNext(0);
  });
}

interface StartOpts {
  host?: string;
  port?: string;
  foreground?: boolean;
  open?: boolean;
  qr?: boolean;
}

async function waitForHealth(url: string, ms: number): Promise<HealthDTO | undefined> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const h = await fetchHealth(url, 800);
    if (h) return h;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

function printAccess(app: App, baseUrl: string, token: string, qr: boolean): void {
  const out = (s = '') => process.stdout.write(`${s}\n`);
  const lang: Lang = app.lang;
  out(pc.bold(t(lang, 'gateway.open.title')));
  out(`  ${pc.cyan(pc.underline(dashboardUrl(baseUrl, token)))}`);
  if (app.platform.isTermux) out(pc.dim(t(lang, 'gateway.open.termux')));
  const host = app.config.gateway.host;
  if (qr) {
    const lan = lanAddress();
    const target =
      host === '0.0.0.0' && lan
        ? dashboardUrl(`http://${lan}:${app.config.gateway.port}`, token)
        : dashboardUrl(baseUrl, token);
    if (host !== '0.0.0.0') out(pc.yellow(t(lang, 'gateway.qr.local')));
    import('qrcode-terminal')
      .then((m) => m.default.generate(target, { small: true }, (code: string) => out(code)))
      .catch(() => out(target));
  }
}

async function runForeground(app: App, host?: string, port?: number): Promise<void> {
  const out = (s = '') => process.stdout.write(`${s}\n`);
  let stopping = false;
  let stopNow: () => void = () => undefined;
  const gw = await createGateway(app, {
    host,
    port,
    uiDir: defaultUiDir(),
    onShutdown: () => stopNow(),
  });
  // Own the pid file whoever started us (terminal, `sindar app connect`, the Android app), so
  // `sindar gateway stop|restart` and `sindar update` can always find this process.
  const files = gatewayFiles(app.paths.home, app.paths.logs);
  const otherPid = readPid(files.pid);
  if (!otherPid || otherPid === process.pid || !processAlive(otherPid)) {
    try {
      fs.mkdirSync(path.dirname(files.pid), { recursive: true });
      fs.writeFileSync(files.pid, `${process.pid}\n`);
    } catch {
      /* ignore */
    }
  }
  out(pc.green(t(app.lang, 'gateway.started', { url: gw.url })));
  printAccess(app, gw.url, gw.token, false);
  out(pc.dim(t(app.lang, 'gateway.foreground.hint')));
  await new Promise<void>((resolve) => {
    stopNow = () => {
      if (stopping) return;
      stopping = true;
      out(pc.dim(t(app.lang, 'gateway.stopping')));
      gw.close()
        .catch(() => undefined)
        .finally(() => {
          if (readPid(files.pid) === process.pid) {
            try {
              fs.unlinkSync(files.pid);
            } catch {
              /* ignore */
            }
          }
          resolve();
        });
    };
    process.once('SIGINT', stopNow);
    process.once('SIGTERM', stopNow);
  });
}

/** Ask a running gateway to exit through its API (works for brains we did not spawn). */
async function requestShutdown(url: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForDown(url: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await fetchHealth(url, 800))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return !(await fetchHealth(url, 800));
}

export async function ensureGatewayRunning(
  app: App,
  opts: { host?: string; port?: number; quiet?: boolean } = {},
): Promise<{ url: string; token: string; started: boolean; health: HealthDTO }> {
  const url = gatewayUrl(app, opts.host, opts.port);
  const token = process.env.SINDAR_GATEWAY_TOKEN ?? loadOrCreateToken(app.paths.home);
  const existing = await fetchHealth(url);
  if (existing) return { url, token, started: false, health: existing };

  const files = gatewayFiles(app.paths.home, app.paths.logs);
  fs.mkdirSync(path.dirname(files.log), { recursive: true });
  const logFd = fs.openSync(files.log, 'a');
  // process.argv[1] is the CLI entry (dist/index.js) both when installed and in the monorepo.
  const args = [process.argv[1]!, '--home', app.paths.home, 'gateway', 'run'];
  if (opts.host) args.push('--host', opts.host);
  if (opts.port) args.push('--port', String(opts.port));
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, SINDAR_LANG: app.lang },
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(logFd);
  if (child.pid) fs.writeFileSync(files.pid, `${child.pid}\n`);
  const health = await waitForHealth(url, 15_000);
  if (!health) {
    let tail = '';
    try {
      tail = fs.readFileSync(files.log, 'utf8').split('\n').slice(-12).join('\n');
    } catch {
      /* ignore */
    }
    throw new Error(`${t(app.lang, 'gateway.start.failed', { log: files.log })}\n${tail}`);
  }
  return { url, token, started: true, health };
}

export async function stopGateway(app: App): Promise<boolean> {
  const files = gatewayFiles(app.paths.home, app.paths.logs);
  const pid = readPid(files.pid);
  const url = gatewayUrl(app);
  if (pid && processAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && processAlive(pid)) await new Promise((r) => setTimeout(r, 200));
    if (processAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
  if (await fetchHealth(url)) {
    // Still answering (started by someone else, or the pid file was stale): ask it to quit.
    const token = process.env.SINDAR_GATEWAY_TOKEN ?? loadOrCreateToken(app.paths.home);
    await requestShutdown(url, token);
    if (!(await waitForDown(url, 10_000))) return false;
  }
  try {
    fs.unlinkSync(files.pid);
  } catch {
    /* ignore */
  }
  if (app.platform.isTermux) execFile('termux-wake-unlock', [], () => undefined);
  return true;
}

/**
 * Stop (if running) and start again — used by `gateway restart` and after `sindar update`.
 * Returns what happened so callers can be honest with the user.
 */
export async function restartGateway(
  app: App,
): Promise<{ ok: boolean; url: string; token: string; health?: HealthDTO; wasRunning: boolean }> {
  const url = gatewayUrl(app);
  const wasRunning = Boolean(await fetchHealth(url));
  if (wasRunning && !(await stopGateway(app))) {
    const token = process.env.SINDAR_GATEWAY_TOKEN ?? loadOrCreateToken(app.paths.home);
    return { ok: false, url, token, wasRunning };
  }
  const r = await ensureGatewayRunning(app);
  return { ok: true, url: r.url, token: r.token, health: r.health, wasRunning };
}

export function registerGateway(program: Command): void {
  const gw = program
    .command('gateway')
    .description('run the local brain server for the web UI and apps / خادم SINDAR المحلي');

  gw.command('start', { isDefault: true })
    .description('start in the background (use --foreground to stay attached)')
    .option('--host <host>', 'bind address (127.0.0.1 = this device only)')
    .option('--port <port>', 'port (default 18789)')
    .option('-f, --foreground', 'stay attached to this terminal')
    .option('--open', 'open the dashboard in the browser')
    .option('--qr', 'print a QR code with the access link')
    .action(async (opts: StartOpts, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      const port = opts.port ? Number.parseInt(opts.port, 10) : undefined;
      const out = (s = '') => process.stdout.write(`${s}\n`);
      try {
        if (opts.foreground) {
          await runForeground(app, opts.host, port);
          return;
        }
        const r = await ensureGatewayRunning(app, { host: opts.host, port });
        out(
          pc.green(t(app.lang, r.started ? 'gateway.started' : 'gateway.already', { url: r.url })),
        );
        printAccess(app, r.url, r.token, Boolean(opts.qr));
        out(pc.dim(t(app.lang, 'gateway.bg.hint')));
        if (opts.open) await openInBrowser(dashboardUrl(r.url, r.token), app.platform.isTermux);
      } catch (err) {
        process.stderr.write(`${pc.red((err as Error).message)}\n`);
        process.exitCode = 1;
      } finally {
        await app.close();
      }
    });

  gw.command('run', { hidden: true })
    .option('--host <host>')
    .option('--port <port>')
    .action(async (opts: { host?: string; port?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const port = opts.port ? Number.parseInt(opts.port, 10) : undefined;
        // Idempotent: the Android app fires `gateway run` blindly through Termux; if a gateway
        // already answers on this port just say so instead of failing with EADDRINUSE.
        const url = gatewayUrl(app, opts.host, port);
        if (await fetchHealth(url)) {
          process.stdout.write(`${pc.green(t(app.lang, 'gateway.already', { url }))}\n`);
          return;
        }
        await runForeground(app, opts.host, port);
      } finally {
        await app.close();
      }
    });

  gw.command('stop')
    .description('stop the background gateway')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const ok = await stopGateway(app);
        process.stdout.write(
          `${ok ? pc.green(t(app.lang, 'gateway.stopped')) : pc.yellow(t(app.lang, 'gateway.stop.foreign'))}\n`,
        );
      } finally {
        await app.close();
      }
    });

  gw.command('restart')
    .description('stop then start again')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const r = await restartGateway(app);
        if (!r.ok) {
          process.stdout.write(`${pc.yellow(t(app.lang, 'gateway.stop.foreign'))}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`${pc.green(t(app.lang, 'gateway.started', { url: r.url }))}\n`);
        printAccess(app, r.url, r.token, false);
      } catch (err) {
        process.stderr.write(`${pc.red((err as Error).message)}\n`);
        process.exitCode = 1;
      } finally {
        await app.close();
      }
    });

  gw.command('status')
    .description('is the gateway running?')
    .option('--json', 'machine-readable')
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const url = gatewayUrl(app);
        const files = gatewayFiles(app.paths.home, app.paths.logs);
        const health = await fetchHealth(url);
        const pid = readPid(files.pid);
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ url, running: Boolean(health), pid, health }, null, 2)}\n`,
          );
          return;
        }
        if (health) {
          process.stdout.write(
            `${pc.green(t(app.lang, 'gateway.status.up', { url, uptime: formatUptime(health.uptimeS) }))}\n`,
          );
          process.stdout.write(
            `${pc.dim(
              t(app.lang, 'gateway.status.detail', {
                model: health.model,
                sessions: health.sessions,
                running: health.running,
                pending: health.pending,
                version: `${health.version} (${health.build.slice(0, 7)})`,
              }),
            )}\n`,
          );
          if (health.pending > 0)
            process.stdout.write(`${pc.yellow(t(app.lang, 'gateway.status.pending'))}\n`);
        } else {
          process.stdout.write(`${pc.yellow(t(app.lang, 'gateway.status.down', { url }))}\n`);
          process.exitCode = 3;
        }
      } finally {
        await app.close();
      }
    });

  gw.command('logs')
    .description('show the last lines of the gateway log')
    .option('-n, --lines <n>', 'how many lines', '40')
    .action(async (opts: { lines: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const files = gatewayFiles(app.paths.home, app.paths.logs);
        const n = Number.parseInt(opts.lines, 10) || 40;
        let text = '';
        try {
          text = fs.readFileSync(files.log, 'utf8');
        } catch {
          process.stdout.write(`${t(app.lang, 'gateway.logs.none', { file: files.log })}\n`);
          return;
        }
        process.stdout.write(`${text.trimEnd().split('\n').slice(-n).join('\n')}\n`);
      } finally {
        await app.close();
      }
    });

  gw.command('token')
    .description('show (or --rotate) the access token')
    .option('--rotate', 'generate a new token (clients must reconnect)')
    .action(async (opts: { rotate?: boolean }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const token = opts.rotate ? rotateToken(app.paths.home) : loadOrCreateToken(app.paths.home);
        process.stdout.write(`${token}\n`);
        if (opts.rotate)
          process.stderr.write(`${pc.yellow(t(app.lang, 'gateway.token.rotated'))}\n`);
      } finally {
        await app.close();
      }
    });
}

export function registerDashboard(program: Command): void {
  program
    .command('dashboard')
    .alias('ui')
    .description('open the web UI (starts the gateway if needed) / افتح الواجهة')
    .option('--no-open', 'only print the link')
    .option('--qr', 'print a QR code with the access link')
    .action(async (opts: { open: boolean; qr?: boolean }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      const out = (s = '') => process.stdout.write(`${s}\n`);
      try {
        const r = await ensureGatewayRunning(app);
        if (r.started) out(pc.green(t(app.lang, 'gateway.started', { url: r.url })));
        printAccess(app, r.url, r.token, Boolean(opts.qr));
        if (opts.open) {
          const ok = await openInBrowser(dashboardUrl(r.url, r.token), app.platform.isTermux);
          if (!ok) out(pc.dim(t(app.lang, 'gateway.open.manual')));
        }
      } catch (err) {
        process.stderr.write(`${pc.red((err as Error).message)}\n`);
        process.exitCode = 1;
      } finally {
        await app.close();
      }
    });
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
