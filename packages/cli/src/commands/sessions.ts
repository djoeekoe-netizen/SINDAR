import type { Command } from 'commander';
import pc from 'picocolors';
import { t } from '@sindar/core';
import { bootstrap } from '../app.js';
import { formatSessions } from './chat.js';

function when(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function registerSessions(program: Command): void {
  const sessions = program
    .command('sessions')
    .description('list or search sessions (resume with: sindar chat -r <id>) / الجلسات')
    .option('-n, --limit <n>', 'how many', '15')
    .option('--delete <id>', 'delete a session');

  sessions
    .command('search <query...>')
    .description('full-text search across all past conversations / بحث في المحادثات السابقة')
    .option('-n, --limit <n>', 'max sessions', '8')
    .action(async (words: string[], opts: { limit: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const q = words.join(' ');
        const results = app.store.search(q, { limit: Number.parseInt(opts.limit, 10) || 8 });
        if (!results.length) {
          process.stdout.write(`${t(app.lang, 'sessions.search.none', { q })}\n`);
          return;
        }
        const out = [pc.bold(t(app.lang, 'sessions.search.title', { q }))];
        for (const r of results) {
          const s = r.session;
          out.push(
            `${pc.cyan(s.id.slice(0, 8))}  ${pc.dim(when(s.updatedAt))}  ${pc.dim(`${s.messageCount} msgs`)}  ${s.title ?? ''}`,
          );
          for (const h of r.hits) out.push(`    ${pc.dim(`${h.role}:`)} ${h.snippet}`);
        }
        out.push('', pc.dim('sindar chat -r <id>'));
        process.stdout.write(`${out.join('\n')}\n`);
      } finally {
        await app.close();
      }
    });

  sessions.action(async (opts: { limit: string; delete?: string }, cmd: Command) => {
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
