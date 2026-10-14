import type { Command } from 'commander';
import pc from 'picocolors';
import { MemoryFiles, MemoryError, t, type MemoryTarget } from '@sindar/core';
import { bootstrap } from '../app.js';

function filesFor(app: Awaited<ReturnType<typeof bootstrap>>): MemoryFiles {
  return new MemoryFiles(app.paths, {
    memory: app.config.memory.maxChars,
    user: app.config.memory.userMaxChars,
  });
}

const targetOf = (v: string | undefined): MemoryTarget => (v === 'user' ? 'user' : 'memory');

export function registerMemory(program: Command): void {
  const memory = program
    .command('memory')
    .description('show or edit long-term memory (MEMORY.md / USER.md) / الذاكرة');

  memory
    .command('show', { isDefault: true })
    .description('print both memory files with entry ids')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const mem = filesFor(app);
        const out: string[] = [pc.bold(t(app.lang, 'memory.title')), ''];
        for (const target of ['user', 'memory'] as const) {
          const st = mem.stats(target);
          out.push(
            pc.cyan(
              t(app.lang, 'memory.file', {
                name: target === 'user' ? 'USER.md' : 'MEMORY.md',
                entries: st.entries,
                chars: st.chars,
                limit: st.limit,
              }),
            ),
          );
          out.push(pc.dim(mem.file(target)));
          const body = mem.format(target);
          out.push(body === '(empty)' ? pc.dim(t(app.lang, 'memory.empty')) : body, '');
        }
        out.push(pc.dim(t(app.lang, 'memory.hint')));
        process.stdout.write(`${out.join('\n')}\n`);
      } finally {
        await app.close();
      }
    });

  memory
    .command('add <text>')
    .description('add one entry (default target: memory; --user for USER.md)')
    .option('--user', 'save to USER.md (who you are / preferences)')
    .option('--section <heading>', 'file it under a "## heading"')
    .action(async (text: string, opts: { user?: boolean; section?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const target = targetOf(opts.user ? 'user' : 'memory');
        const e = filesFor(app).add(target, text, opts.section);
        process.stdout.write(`${t(app.lang, 'memory.added', { target, id: e.id })}\n`);
      } catch (err) {
        if (err instanceof MemoryError) {
          process.stderr.write(`${pc.red(err.message)}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      } finally {
        await app.close();
      }
    });

  memory
    .command('remove <id>')
    .description('remove an entry by its id (see: sindar memory)')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const mem = filesFor(app);
        const target: MemoryTarget = mem.list('memory').some((e) => e.id === id)
          ? 'memory'
          : 'user';
        mem.remove(target, id);
        process.stdout.write(`${t(app.lang, 'memory.removed', { id })}\n`);
      } catch (err) {
        if (err instanceof MemoryError) {
          process.stderr.write(`${pc.red(err.message)}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      } finally {
        await app.close();
      }
    });

  memory
    .command('path')
    .description('print the memory file paths')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        process.stdout.write(`${app.paths.user}\n${app.paths.memory}\n${app.paths.soul}\n`);
      } finally {
        await app.close();
      }
    });
}
