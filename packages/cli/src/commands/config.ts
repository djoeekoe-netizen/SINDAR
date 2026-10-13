import type { Command } from 'commander';
import fs from 'node:fs';
import pc from 'picocolors';
import { stringify } from 'yaml';
import { coerceValue, getConfigValue, setConfigValue, ConfigError, t } from '@sindar/core';
import { bootstrap } from '../app.js';

export function registerConfig(program: Command): void {
  const cfg = program
    .command('config')
    .description('read or change settings in config.yaml / الإعدادات');

  cfg
    .command('get [key]')
    .description('print a setting (dot path, e.g. agent.approvalMode) or the whole config')
    .action(async (key: string | undefined, _o: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const value = key ? getConfigValue(app.config, key) : app.config;
        if (value === undefined) {
          process.stderr.write(`${t(app.lang, 'config.unknown', { key: key ?? '' })}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(typeof value === 'object' ? stringify(value) : `${String(value)}\n`);
      } finally {
        await app.close();
      }
    });

  cfg
    .command('set <key> <value>')
    .description('change a setting, e.g. `sindar config set agent.approvalMode yolo`')
    .action(async (key: string, value: string, _o: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const v = coerceValue(value);
        setConfigValue(app.paths.config, key, v);
        process.stdout.write(
          `${pc.green(t(app.lang, 'config.saved', { key, value: JSON.stringify(v) }))}\n`,
        );
      } catch (err) {
        const msg =
          err instanceof ConfigError
            ? err.issues.join('; ') || err.message
            : (err as Error).message;
        process.stderr.write(`${pc.red(t(app.lang, 'config.invalid', { error: msg }))}\n`);
        process.exitCode = 1;
      } finally {
        await app.close();
      }
    });

  cfg
    .command('path')
    .description('print the config file location')
    .action(async (_o: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        process.stdout.write(`${t(app.lang, 'config.path', { path: app.paths.config })}\n`);
        process.stdout.write(`${fs.existsSync(app.paths.env) ? app.paths.env : ''}\n`);
      } finally {
        await app.close();
      }
    });
}
