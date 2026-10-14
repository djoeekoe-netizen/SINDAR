import fs from 'node:fs';
import type { Command } from 'commander';
import pc from 'picocolors';
import {
  SkillError,
  SkillStore,
  fetchGitHubSkills,
  installBundle,
  parseSkillSpec,
  scanSkillFiles,
  t,
  type ScanWarning,
} from '@sindar/core';
import { bootstrap } from '../app.js';

type App = Awaited<ReturnType<typeof bootstrap>>;
const storeFor = (app: App) =>
  new SkillStore({ user: app.paths.skills, extra: app.config.skills.extraDirs });

function printWarnings(lang: 'ar' | 'en', warnings: ScanWarning[]): void {
  if (!warnings.length) return;
  process.stdout.write(`${pc.yellow(t(lang, 'skills.warnings', { count: warnings.length }))}\n`);
  for (const w of warnings.slice(0, 20)) {
    const icon = w.level === 'danger' ? pc.red('✖') : pc.yellow('⚠');
    process.stdout.write(`  ${icon} ${w.file}:${w.line} — ${w.pattern}\n     ${pc.dim(w.text)}\n`);
  }
}

function fail(err: unknown): void {
  if (err instanceof SkillError) {
    process.stderr.write(`${pc.red(err.message)}\n`);
    process.exitCode = 1;
    return;
  }
  throw err;
}

export function registerSkills(program: Command): void {
  const skills = program
    .command('skills')
    .description('list, show, create, install or remove skills (reusable procedures) / المهارات');

  skills
    .command('list', { isDefault: true })
    .description('list all skills')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const all = storeFor(app).list();
        const out = [
          pc.bold(t(app.lang, 'skills.title', { count: all.length, dir: app.paths.skills })),
        ];
        if (!all.length) out.push(pc.dim(t(app.lang, 'skills.none')));
        for (const s of all) {
          out.push(
            `${pc.cyan(s.name.padEnd(22))} ${pc.dim(`v${s.version}`.padEnd(8))} ${pc.dim(`[${s.source}]`.padEnd(11))} ${s.description}`,
          );
        }
        out.push('', pc.dim(t(app.lang, 'skills.mode', { mode: app.config.skills.autoCreate })));
        process.stdout.write(`${out.join('\n')}\n`);
      } finally {
        await app.close();
      }
    });

  skills
    .command('show <name>')
    .description('print a skill (SKILL.md)')
    .action(async (name: string, _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const s = storeFor(app).get(name);
        if (!s) {
          process.stderr.write(`${t(app.lang, 'skills.notfound', { name })}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`${pc.dim(s.file)}\n\n${s.raw}`);
        if (s.files.length) process.stdout.write(`\n${pc.dim(`files: ${s.files.join(', ')}`)}\n`);
      } finally {
        await app.close();
      }
    });

  skills
    .command('create <name>')
    .description('create a skill from a description and a markdown file (or stdin)')
    .requiredOption('-d, --description <text>', 'one line: when to use it')
    .option('-f, --file <path>', 'markdown body file (default: read from stdin)')
    .option('--tags <list>', 'comma-separated tags')
    .action(
      async (
        name: string,
        opts: { description: string; file?: string; tags?: string },
        cmd: Command,
      ) => {
        const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
        const app = await bootstrap({ home: g.home, lang: g.lang });
        try {
          const body = opts.file ? fs.readFileSync(opts.file, 'utf8') : fs.readFileSync(0, 'utf8');
          const s = storeFor(app).create({
            name,
            description: opts.description,
            body,
            tags: opts.tags
              ?.split(',')
              .map((x) => x.trim())
              .filter(Boolean),
          });
          process.stdout.write(
            `${t(app.lang, 'skills.created', { name: s.name, path: s.file })}\n`,
          );
        } catch (err) {
          fail(err);
        } finally {
          await app.close();
        }
      },
    );

  skills
    .command('install <source>')
    .description('install from GitHub: github:owner/repo[/path][@ref] or a github.com URL')
    .option('-y, --yes', 'install even if the security scan found dangerous content')
    .option('--overwrite', 'replace an existing skill with the same name')
    .option('--dry-run', 'fetch and scan only; do not write anything')
    .action(
      async (
        source: string,
        opts: { yes?: boolean; overwrite?: boolean; dryRun?: boolean },
        cmd: Command,
      ) => {
        const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
        const app = await bootstrap({ home: g.home, lang: g.lang });
        try {
          const spec = parseSkillSpec(source);
          process.stdout.write(`${pc.dim(t(app.lang, 'skills.fetching', { source }))}\n`);
          const bundles = await fetchGitHubSkills(spec, {
            token: app.env.GITHUB_TOKEN,
            signal: AbortSignal.timeout(45_000),
          });
          const store = storeFor(app);
          for (const b of bundles) {
            const warnings = scanSkillFiles(b.files);
            process.stdout.write(
              `${pc.bold(b.name)} ${pc.dim(`(${b.files.length} file(s): ${b.files.map((f) => f.path).join(', ')})`)}\n`,
            );
            printWarnings(app.lang, warnings);
            if (opts.dryRun) continue;
            if (warnings.some((w) => w.level === 'danger') && !opts.yes) {
              process.stdout.write(`${pc.red(t(app.lang, 'skills.danger'))}\n`);
              process.exitCode = 1;
              continue;
            }
            try {
              const r = installBundle(store, b, { force: opts.yes, overwrite: opts.overwrite });
              process.stdout.write(
                `${pc.green('✔')} ${t(app.lang, 'skills.installed', { name: r.skill.name, origin: b.origin })}\n`,
              );
            } catch (err) {
              fail(err);
            }
          }
          process.stdout.write(`${pc.dim(t(app.lang, 'skills.scriptsNote'))}\n`);
        } catch (err) {
          fail(err);
        } finally {
          await app.close();
        }
      },
    );

  skills
    .command('remove <name>')
    .alias('rm')
    .description('delete a skill')
    .action(async (name: string, _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        storeFor(app).remove(name);
        process.stdout.write(`${t(app.lang, 'skills.removed', { name })}\n`);
      } catch (err) {
        fail(err);
      } finally {
        await app.close();
      }
    });
}
