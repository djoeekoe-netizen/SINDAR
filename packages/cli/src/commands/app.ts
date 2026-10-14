import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { commandExists, t } from '@sindar/core';
import { bootstrap, type App } from '../app.js';
import { ensureGatewayRunning, openInBrowser } from './gateway.js';

/**
 * `sindar app` — pairs the Android app (apps/android) with the brain running in this Termux:
 * starts the gateway if needed, lets Termux accept the app's "start the brain" request
 * (allow-external-apps), then hands the gateway URL + token to the app through a
 * `sindar://connect` deep link opened with `am start`.
 */

export const APK_URL =
  'https://github.com/djoeekoe-netizen/SINDAR/releases/download/dev/SINDAR-dev.apk';
export const APP_PACKAGE = 'com.sindar.app';
export const APP_ACTIVITY = `${APP_PACKAGE}/.MainActivity`;

/** Deep link the app understands (see apps/android MainActivity.handleIntent). */
export function connectLink(url: string, token: string): string {
  return `sindar://connect?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
}

/**
 * Set `allow-external-apps = true` in ~/.termux/termux.properties (idempotent). Termux ships the
 * line commented out; we uncomment/replace it or append it. Returns whether the file changed.
 */
export function enableExternalApps(home = os.homedir()): { changed: boolean; file: string } {
  const dir = path.join(home, '.termux');
  const file = path.join(dir, 'termux.properties');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    /* new file */
  }
  const lines = text.length > 0 ? text.split('\n') : [];
  let found = false;
  let changed = false;
  const out = lines.map((line) => {
    const m = /^\s*(#\s*)?allow-external-apps\s*=\s*(\S+)/i.exec(line);
    if (!m) return line;
    found = true;
    if (!m[1] && m[2]?.toLowerCase() === 'true') return line;
    changed = true;
    return 'allow-external-apps = true';
  });
  if (!found) {
    if (out.length > 0 && out.at(-1) !== '') out.push('');
    out.push(
      '# SINDAR: let the SINDAR app start the brain (sindar gateway run) from outside Termux',
    );
    out.push('allow-external-apps = true');
    changed = true;
  }
  if (changed) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `${out.join('\n').replace(/\n*$/, '')}\n`);
  }
  return { changed, file };
}

function run(bin: string, args: string[], timeout = 8000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout }, (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      resolve({ ok: !err && !/Error|Exception|does not exist|unable to resolve/i.test(out), out });
    });
  });
}

/** `am start` the app with the deep link; false when the app is not installed. */
export async function openApp(amBin: string, link: string): Promise<boolean> {
  const explicit = await run(amBin, [
    'start',
    '-n',
    APP_ACTIVITY,
    '-a',
    'android.intent.action.VIEW',
    '-d',
    link,
  ]);
  if (explicit.ok) return true;
  // Older `am` builds reject -n + -d combos; let the system resolve the scheme instead.
  const implicit = await run(amBin, ['start', '-a', 'android.intent.action.VIEW', '-d', link]);
  return implicit.ok;
}

async function connect(app: App, opts: { open: boolean }): Promise<void> {
  const out = (s = '') => process.stdout.write(`${s}\n`);
  const lang = app.lang;
  const r = await ensureGatewayRunning(app, { quiet: true });
  out(pc.green(t(lang, r.started ? 'gateway.started' : 'gateway.already', { url: r.url })));

  if (app.platform.isTermux) {
    const { changed } = enableExternalApps();
    if (changed) {
      const reload = commandExists('termux-reload-settings');
      if (reload) await run(reload, []);
      out(pc.dim(t(lang, 'app.external.enabled')));
    }
  }

  const link = connectLink(r.url, r.token);
  const amBin = opts.open ? commandExists('am') : undefined;
  if (!amBin) {
    out(t(lang, 'app.link'));
    out(`  ${pc.cyan(link)}`);
    if (!app.platform.isTermux) out(pc.dim(t(lang, 'app.notTermux')));
    return;
  }
  out(pc.dim(t(lang, 'app.opening')));
  if (await openApp(amBin, link)) {
    out(pc.green(t(lang, 'app.opened')));
    return;
  }
  out(pc.yellow(t(lang, 'app.missing')));
  out(`  ${pc.cyan(pc.underline(APK_URL))}`);
  out(pc.dim(t(lang, 'app.install.hint')));
}

export function registerApp(program: Command): void {
  program
    .command('app [action]')
    .description('pair the SINDAR Android app with this brain (connect | link | install)')
    .option('--no-open', 'only print the connection link')
    .action(async (action: string | undefined, opts: { open: boolean }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      const out = (s = '') => process.stdout.write(`${s}\n`);
      try {
        const what = action ?? 'connect';
        if (what === 'install' || what === 'download') {
          out(t(app.lang, 'app.install.title'));
          out(`  ${pc.cyan(pc.underline(APK_URL))}`);
          out(pc.dim(t(app.lang, 'app.install.hint')));
          if (opts.open) await openInBrowser(APK_URL, app.platform.isTermux);
          return;
        }
        if (what === 'link') {
          await connect(app, { open: false });
          return;
        }
        if (what === 'connect') {
          await connect(app, opts);
          return;
        }
        process.stderr.write(`${pc.red(t(app.lang, 'app.unknown', { action: what }))}\n`);
        process.exitCode = 2;
      } catch (err) {
        process.stderr.write(`${pc.red((err as Error).message)}\n`);
        process.exitCode = 1;
      } finally {
        await app.close();
      }
    });
}
