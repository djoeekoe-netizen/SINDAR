import type { Command } from 'commander';
import { runDoctor, t, isLang, BUILD, VERSION, type Lang } from '@sindar/core';
import { renderDoctor } from '../render.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check Node, platform, config, database and providers / فحص الجاهزية')
    .option('--json', 'machine-readable output')
    .option('--no-probe', 'skip probing local servers (Ollama etc.)')
    .action(async (opts: { json?: boolean; probe: boolean }) => {
      const globals = program.opts<{ lang?: string; home?: string }>();
      const lang: Lang | undefined = isLang(globals.lang) ? globals.lang : undefined;
      const report = await runDoctor({ home: globals.home, lang, probeLocal: opts.probe });
      if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        const title = t(report.lang, 'doctor.title');
        const version = t(report.lang, 'doctor.version', { version: VERSION, build: BUILD });
        process.stdout.write(renderDoctor(report, title, version) + '\n');
      }
      process.exitCode = report.summary.fail > 0 ? 1 : 0;
    });
}
