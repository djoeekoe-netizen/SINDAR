import type { Command } from 'commander';
import pc from 'picocolors';
import { isChatModelId, resolveProviders, setConfigValue, t } from '@sindar/core';
import { bootstrap } from '../app.js';

export function registerModel(program: Command): void {
  program
    .command('model [ref]')
    .description('show or set the default model (provider:model) / عرض أو ضبط النموذج')
    .option('-l, --list [provider]', 'list models available from a configured provider')
    .option('--fallbacks <refs>', 'comma-separated fallback models')
    .action(
      async (
        ref: string | undefined,
        opts: { list?: string | boolean; fallbacks?: string },
        cmd: Command,
      ) => {
        const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
        const app = await bootstrap({ home: g.home, lang: g.lang });
        const out = (s = '') => process.stdout.write(`${s}\n`);
        try {
          if (opts.fallbacks !== undefined) {
            const list = opts.fallbacks
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            setConfigValue(app.paths.config, 'model.fallbacks', list);
            out(
              t(app.lang, 'model.fallbacks', {
                list: list.join(', ') || t(app.lang, 'model.none'),
              }),
            );
          }
          if (ref) {
            const { provider } = app.registry.parse(ref);
            const r = app.registry.resolve(provider);
            if (!r) throw new Error(`unknown provider "${provider}"`);
            setConfigValue(app.paths.config, 'model.default', ref);
            out(pc.green(t(app.lang, 'model.set', { model: ref })));
            if (!r.configured) out(pc.yellow(t(app.lang, 'model.warn.unconfigured', { provider })));
            return;
          }
          if (opts.list) {
            const id =
              typeof opts.list === 'string'
                ? opts.list
                : app.registry.parse(app.config.model.default).provider;
            const provider = app.registry.get(id);
            out(t(app.lang, 'model.listing', { provider: id }));
            const models = (await provider.listModels()).filter((m) => isChatModelId(m.id));
            for (const m of models)
              out(`  ${id}:${m.id}${m.contextWindow ? pc.dim(`  (${m.contextWindow} ctx)`) : ''}`);
            return;
          }
          out(t(app.lang, 'model.current', { model: app.config.model.default }));
          out(
            t(app.lang, 'model.fallbacks', {
              list: app.config.model.fallbacks.join(', ') || t(app.lang, 'model.none'),
            }),
          );
          out();
          out(t(app.lang, 'model.providers'));
          for (const p of resolveProviders(app.config, app.env).filter(
            (x) => x.kind !== 'mock' && x.enabled,
          )) {
            const status = p.configured
              ? pc.green(t(app.lang, 'model.ready'))
              : pc.dim(t(app.lang, 'model.nokey', { env: p.apiKeyEnv ?? '-' }));
            const tier =
              p.free === 'local'
                ? t(app.lang, 'onboard.provider.local')
                : p.free === 'free-tier'
                  ? t(app.lang, 'onboard.provider.free')
                  : t(app.lang, 'onboard.provider.paid');
            out(`  ${p.id.padEnd(12)} ${status.padEnd(28)} ${pc.dim(tier)}`);
          }
        } finally {
          await app.close();
        }
      },
    );
}
