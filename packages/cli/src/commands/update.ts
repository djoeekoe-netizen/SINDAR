import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Option, type Command } from 'commander';
import pc from 'picocolors';
import { BUILD, commandExists, sameBuild, t, isLang, type Lang } from '@sindar/core';
import { bootstrap } from '../app.js';
import { fetchHealth, gatewayUrl, restartGateway } from './gateway.js';

export const DEFAULT_REPO = 'djoeekoe-netizen/SINDAR';

export function tarballUrl(repo: string, channel: string): string {
  return `https://github.com/${repo}/releases/download/${channel}/sindar-cli.tgz`;
}

export function versionUrl(repo: string, channel: string): string {
  return `https://github.com/${repo}/releases/download/${channel}/version.json`;
}

export interface ReleaseInfo {
  version?: string;
  sha?: string;
  date?: string;
}

/** What the release channel currently publishes (best effort — offline just returns undefined). */
export async function fetchReleaseInfo(
  url: string,
  timeoutMs = 8000,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseInfo | undefined> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as ReleaseInfo;
    return typeof json === 'object' && json ? json : undefined;
  } catch {
    return undefined;
  }
}

export { sameBuild };

/** Parse the output of `sindar --version` ("0.1.0 (abc1234…)"). */
export function parseVersionOutput(out: string): { version: string; build: string } | undefined {
  const m = /^(\S+)\s*\(([^)]+)\)/.exec(out.trim());
  return m ? { version: m[1]!, build: m[2]! } : undefined;
}

/**
 * Version + build of the `sindar` that is installed on disk right now. Re-executes the CLI entry
 * (process.argv[1]) so that, right after `npm install`, we see the NEW code and not this process.
 */
export async function installedBuild(): Promise<{ version: string; build: string } | undefined> {
  const entry = process.argv[1];
  if (!entry) return undefined;
  return new Promise((resolve) => {
    execFile(process.execPath, [entry, '--version'], { timeout: 20_000 }, (err, stdout) => {
      resolve(err ? undefined : parseVersionOutput(String(stdout)));
    });
  });
}

function run(cmd: string, args: string[], shell = false): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell });
    child.on('exit', (c) => resolve(c ?? 1));
    child.on('error', () => resolve(1));
  });
}

interface UpdateOpts {
  channel: string;
  repo: string;
  force?: boolean;
  restart?: boolean;
  /** Hidden: second phase, executed by the freshly installed binary. */
  finish?: boolean;
}

/**
 * Phase two of an update: make sure the brain that is running uses the code that is installed.
 * Runs inside the NEW binary (re-executed after `npm install`), so the newest stop/restart logic
 * is the one that deals with whatever old gateway is still around.
 */
async function finishUpdate(
  lang: Lang,
  globals: { home?: string; lang?: string },
  target: string,
): Promise<void> {
  const out = (s: string) => process.stdout.write(`${s}\n`);
  try {
    const app = await bootstrap({ home: globals.home, lang: globals.lang });
    try {
      const health = await fetchHealth(gatewayUrl(app));
      if (!health) {
        out(pc.dim(t(lang, 'update.gateway.down')));
        return;
      }
      if (sameBuild(health.build, target)) {
        out(pc.green(t(lang, 'update.gateway.current')));
        return;
      }
      out(pc.cyan(t(lang, 'update.gateway.restarting', { build: health.build.slice(0, 7) })));
      const r = await restartGateway(app, { log: (line) => out(pc.dim(line)) });
      if (r.ok) {
        out(
          pc.green(
            t(lang, 'update.gateway.restarted', { build: (r.health?.build ?? '?').slice(0, 7) }),
          ),
        );
      } else {
        out(pc.yellow(t(lang, 'update.gateway.failed')));
        process.exitCode = 1;
      }
    } finally {
      await app.close();
    }
  } catch (err) {
    out(pc.yellow(t(lang, 'update.gateway.failed')));
    out(pc.dim((err as Error).message));
    process.exitCode = 1;
  }
}

export function registerUpdate(program: Command): void {
  program
    .command('update')
    .description('Update SINDAR to the latest build / تحديث SINDAR')
    .option(
      '--channel <name>',
      'release channel (dev | latest)',
      process.env.SINDAR_CHANNEL ?? 'dev',
    )
    .option('--repo <owner/name>', 'GitHub repository', process.env.SINDAR_REPO ?? DEFAULT_REPO)
    .option('-f, --force', 'reinstall even when already on the latest build')
    .option('--no-restart', 'do not restart a running brain (gateway) after updating')
    .addOption(new Option('--finish').hideHelp())
    .action(async (opts: UpdateOpts) => {
      const globals = program.opts<{ lang?: string; home?: string }>();
      const lang: Lang = isLang(globals.lang) ? globals.lang : 'ar';
      const out = (s: string) => process.stdout.write(`${s}\n`);
      if (opts.finish) {
        await finishUpdate(lang, globals, BUILD);
        return;
      }
      const npm =
        commandExists(process.platform === 'win32' ? 'npm.cmd' : 'npm') ?? commandExists('npm');
      if (!npm) {
        process.stderr.write(pc.red(t(lang, 'update.npm.missing')) + '\n');
        process.exitCode = 1;
        return;
      }

      const url = tarballUrl(opts.repo, opts.channel);
      const release = await fetchReleaseInfo(versionUrl(opts.repo, opts.channel));
      let installed: { version: string; build: string } | undefined;

      if (release?.sha && sameBuild(release.sha, BUILD) && !opts.force) {
        out(
          pc.green(
            t(lang, 'update.uptodate', { version: `${release.version} (${BUILD.slice(0, 7)})` }),
          ),
        );
      } else {
        out(pc.cyan(t(lang, 'update.start', { channel: opts.channel })) + '\n' + pc.dim(url));
        const base = ['install', '-g', url, '--no-fund', '--no-audit', '--prefer-online'];
        const shell = process.platform === 'win32';
        let code = await run(npm, base, shell);
        if (code === 0) {
          installed = await installedBuild();
          // npm sometimes serves a cached tarball for the same URL — detect it and refetch cleanly.
          if (release?.sha && installed && !sameBuild(installed.build, release.sha)) {
            out(pc.yellow(t(lang, 'update.retry')));
            const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-npm-'));
            code = await run(npm, [...base, '--cache', cache], shell);
            if (code === 0) installed = await installedBuild();
            fs.rmSync(cache, { recursive: true, force: true });
          }
        }
        if (code !== 0) {
          process.stderr.write(
            pc.red(t(lang, 'update.fail', { error: `npm exit ${code}` })) + '\n',
          );
          process.exitCode = code;
          return;
        }
        const label = installed
          ? `${installed.version} (${installed.build.slice(0, 7)})`
          : t(lang, 'update.unknown');
        out(pc.green(t(lang, 'update.done', { version: label })));
        if (release?.sha && installed && !sameBuild(installed.build, release.sha))
          out(pc.yellow(t(lang, 'update.mismatch', { build: release.sha.slice(0, 7) })));
      }

      // The brain keeps the OLD code in memory until it is restarted — do it for the user, and let
      // the binary we just installed do it (its stop logic is the newest one).
      if (opts.restart === false) return;
      const entry = process.argv[1];
      if (installed && entry) {
        const flags = [
          ...(globals.home ? ['--home', globals.home] : []),
          ...(globals.lang ? ['--lang', globals.lang] : []),
        ];
        const code = await run(process.execPath, [entry, ...flags, 'update', '--finish']);
        if (code !== 0) process.exitCode = code;
        return;
      }
      await finishUpdate(lang, globals, installed?.build ?? release?.sha ?? BUILD);
    });
}
