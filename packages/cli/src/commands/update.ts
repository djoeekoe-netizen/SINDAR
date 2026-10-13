import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import pc from 'picocolors';
import { commandExists, t, isLang, type Lang } from '@sindar/core';

export const DEFAULT_REPO = 'djoeekoe-netizen/SINDAR';

export function tarballUrl(repo: string, channel: string): string {
  return `https://github.com/${repo}/releases/download/${channel}/sindar-cli.tgz`;
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
    .action(async (opts: { channel: string; repo: string }) => {
      const globals = program.opts<{ lang?: string }>();
      const lang: Lang = isLang(globals.lang) ? globals.lang : 'ar';
      const npm =
        commandExists(process.platform === 'win32' ? 'npm.cmd' : 'npm') ?? commandExists('npm');
      if (!npm) {
        process.stderr.write(pc.red(t(lang, 'update.npm.missing')) + '\n');
        process.exitCode = 1;
        return;
      }
      const url = tarballUrl(opts.repo, opts.channel);
      process.stdout.write(
        pc.cyan(t(lang, 'update.start', { channel: opts.channel })) + '\n' + pc.dim(url) + '\n',
      );
      const code = await new Promise<number>((resolve) => {
        const child = spawn(npm, ['install', '-g', url, '--no-fund', '--no-audit'], {
          stdio: 'inherit',
          shell: process.platform === 'win32',
        });
        child.on('exit', (c) => resolve(c ?? 1));
        child.on('error', () => resolve(1));
      });
      if (code === 0) process.stdout.write(pc.green(t(lang, 'update.done')) + '\n');
      else
        process.stderr.write(pc.red(t(lang, 'update.fail', { error: `npm exit ${code}` })) + '\n');
      process.exitCode = code;
    });
}
