import type { Command } from 'commander';
import { t } from '@sindar/core';
import { bootstrap } from '../app.js';
import { formatSessions } from './chat.js';

export function registerSessions(program: Command): void {
  program
    .command('sessions')
    .description('list recent sessions (resume with: sindar chat -r <id>) / الجلسات')
    .option('-n, --limit <n>', 'how many', '15')
    .option('--delete <id>', 'delete a session')
    .action(async (opts: { limit: string; delete?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        if (opts.delete) {
          const s = app.store.find(opts.delete);
          if (!s) {
            process.stderr.write(`${t(app.lang, 'sessions.notfound', { id: opts.delete })}\n`);
            process.exitCode = 1;
            return;
          }
          app.store.delete(s.id);
          process.stdout.write(`${t(app.lang, 'sessions.deleted', { id: s.id.slice(0, 8) })}\n`);
          return;
        }
        process.stdout.write(`${formatSessions(app, Number.parseInt(opts.limit, 10) || 15)}\n`);
      } finally {
        await app.close();
      }
    });
}
