import type { Command } from 'commander';
import pc from 'picocolors';
import {
  PROVIDER_TEMPLATES,
  collectChat,
  instantiateProvider,
  isChatModelId,
  maskKey,
  resolveProvider,
  setConfigValue,
  upsertEnvVar,
  t,
  type Lang,
  type ProviderTemplate,
  type ResolvedProvider,
} from '@sindar/core';
import { bootstrap, type App } from '../app.js';
import { createPrompter, type Prompter } from '../ui/prompt.js';

interface OnboardOpts {
  provider?: string;
  key?: string | true;
  model?: string;
  approval?: string;
  yes?: boolean;
  /** commander maps --no-test to test:false */
  test?: boolean;
}

const RECOMMENDED = ['groq', 'gemini', 'openrouter', 'cerebras', 'mistral', 'github', 'ollama'];

export function orderedProviders(): ProviderTemplate[] {
  const rank = (p: ProviderTemplate) => {
    const i = RECOMMENDED.indexOf(p.id);
    return (i === -1 ? 100 : i) + (p.free === 'paid' ? 1000 : 0) + (p.free === 'test' ? 10_000 : 0);
  };
  return [...PROVIDER_TEMPLATES]
    .filter((p) => p.kind !== 'mock')
    .toSorted((a, b) => rank(a) - rank(b));
}

export function registerOnboard(program: Command): void {
  program
    .command('onboard')
    .alias('setup')
    .description(
      'guided setup: language, free model provider, API key, default model / الإعداد الأولي',
    )
    .option('--provider <id>', 'skip the menu (groq, gemini, openrouter, ollama, …)')
    .option('--key [key]', 'API key to save; without a value the wizard asks for it visibly')
    .option('--model <id>', 'model id (without the provider prefix)')
    .option('--approval <mode>', 'ask | allowlist | yolo')
    .option('-y, --yes', 'accept defaults without prompting')
    .option('--no-test', 'skip the connectivity test')
    .action(async (opts: OnboardOpts, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      const prompter = createPrompter();
      try {
        process.exitCode = await onboard(app, prompter, opts, g.lang);
      } finally {
        prompter.close();
        await app.close();
      }
    });
}

export async function onboard(
  app: App,
  p: Prompter,
  opts: OnboardOpts,
  langFlag?: string,
): Promise<number> {
  let lang: Lang = app.lang;
  const out = (s = '') => process.stdout.write(`${s}\n`);
  const interactive = !opts.yes && process.stdin.isTTY;
  out(pc.bold(t(lang, 'onboard.title')));
  out();

  // 1) language
  if (interactive && !langFlag) {
    const a = await p.ask(
      `${t(lang, 'onboard.lang')} [${lang === 'ar' ? 1 : 2}]: `,
      lang === 'ar' ? '1' : '2',
    );
    lang = a.trim() === '2' ? 'en' : 'ar';
  }
  if (lang !== app.config.ui.language) setConfigValue(app.paths.config, 'ui.language', lang);

  // 2) provider
  const providers = orderedProviders();
  let tpl: ProviderTemplate | undefined = opts.provider
    ? providers.find((x) => x.id === opts.provider)
    : undefined;
  if (opts.provider && !tpl) {
    out(pc.red(`unknown provider: ${opts.provider}`));
    return 1;
  }
  if (!tpl) {
    if (!interactive) tpl = providers[0]!;
    else {
      out(t(lang, 'onboard.provider.title'));
      providers.forEach((x, i) => {
        const tier =
          x.free === 'local'
            ? t(lang, 'onboard.provider.local')
            : x.free === 'free-tier'
              ? t(lang, 'onboard.provider.free')
              : t(lang, 'onboard.provider.paid');
        const rec = i === 0 ? ` ${pc.green(`★ ${t(lang, 'onboard.provider.recommended')}`)}` : '';
        const note = x.notes ? ` — ${lang === 'ar' ? x.notes.ar : x.notes.en}` : '';
        out(
          `  [${String(i + 1).padStart(2)}] ${x.name.padEnd(16)} ${pc.dim(tier)}${rec}${pc.dim(note)}`,
        );
      });
      const a = await p.ask(t(lang, 'onboard.provider.prompt', { default: 1 }), '1');
      const idx = Number.parseInt(a, 10);
      tpl = providers[Number.isFinite(idx) && idx >= 1 && idx <= providers.length ? idx - 1 : 0]!;
    }
  }
  out(pc.dim(`→ ${tpl.name}`));

  // 3) key
  const envKey = tpl.apiKeyEnv;
  let resolved: ResolvedProvider = resolveProvider(tpl.id, app.config.providers[tpl.id], app.env)!;
  if (tpl.requiresKey && envKey) {
    // `--key` without a value (a common slip: Enter pressed before pasting) → ask visibly.
    let key = typeof opts.key === 'string' ? opts.key.trim() : undefined;
    let visible = opts.key === true;
    const savedKey = resolved.apiKey;
    for (;;) {
      if (!key) {
        if (tpl.signupUrl) out(t(lang, 'onboard.key.url', { url: pc.underline(tpl.signupUrl) }));
        if (tpl.id === 'groq') out(pc.dim(t(lang, 'onboard.key.groqhint')));
        if (savedKey) out(pc.dim(t(lang, 'onboard.key.existing', { masked: maskKey(savedKey) })));
        if (!interactive) {
          if (!savedKey) {
            out(pc.red(t(lang, 'model.nokey', { env: envKey })));
            return 1;
          }
          key = savedKey;
        } else {
          const prompt = t(lang, 'onboard.key.prompt', { env: envKey });
          key = (visible ? await p.ask(prompt) : await p.askHidden(prompt)) || savedKey || '';
        }
        if (!key) {
          out(t(lang, 'onboard.aborted'));
          return 1;
        }
        // "…"/"..." means a masked copy from a list; keys are printable ASCII without spaces.
        const masked = /…|\.\.\.|\*{3,}/.test(key);
        key = key.replace(/[^\x21-\x7e]/g, '');
        out(pc.dim(t(lang, 'onboard.key.received', { masked: maskKey(key), len: key.length })));
        if (masked || key.length < 20) out(pc.yellow(t(lang, 'onboard.key.suspicious')));
      }
      resolved = resolveProvider(tpl.id, app.config.providers[tpl.id], {
        ...app.env,
        [envKey]: key,
      })!;
      if (opts.test === false) break;
      out(pc.dim(t(lang, 'onboard.key.testing')));
      const ping = await instantiateProvider(resolved).ping();
      if (ping.ok) {
        out(pc.green(t(lang, 'onboard.key.ok', { ms: ping.latencyMs ?? 0 })));
        break;
      }
      out(pc.red(t(lang, 'onboard.key.fail', { error: ping.message ?? '?' })));
      if (!interactive || !(await p.confirm(t(lang, 'onboard.key.retry'), true))) return 1;
      key = undefined;
      visible = true;
      out(pc.dim(t(lang, 'onboard.key.visible')));
    }
    app.env[envKey] = key;
    upsertEnvVar(app.paths.env, envKey, key);
    out(pc.dim(t(lang, 'onboard.key.saved', { file: app.paths.env })));
  } else if (!opts.test === false) {
    const ping = await instantiateProvider(resolved).ping();
    if (!ping.ok) {
      out(pc.yellow(t(lang, 'onboard.local.unreachable', { url: resolved.baseUrl ?? '?' })));
      if (interactive && !(await p.confirm(t(lang, 'onboard.key.retry'), false))) return 1;
    }
  }

  // 4) model
  let model = opts.model;
  if (!model) {
    const suggested = tpl.suggestedModels ?? [];
    let remote: string[] = [];
    if (!opts.test === false) {
      out(pc.dim(t(lang, 'onboard.model.fetching')));
      try {
        remote = (await instantiateProvider(resolved).listModels())
          .map((m) => m.id)
          .filter(isChatModelId);
      } catch {
        remote = [];
      }
    }
    const choices = [
      ...new Set([
        ...suggested.filter((s) => remote.length === 0 || remote.includes(s)),
        ...remote,
      ]),
    ].slice(0, 25);
    const def = choices[0] ?? suggested[0] ?? '';
    if (!interactive || choices.length === 0) model = def;
    else {
      out(t(lang, 'onboard.model.title'));
      choices.forEach((m, i) =>
        out(`  [${String(i + 1).padStart(2)}] ${m}${suggested.includes(m) ? pc.green(' ★') : ''}`),
      );
      const a = await p.ask(t(lang, 'onboard.model.prompt', { default: def }), def);
      const idx = Number.parseInt(a, 10);
      model = Number.isFinite(idx) && idx >= 1 && idx <= choices.length ? choices[idx - 1]! : a;
    }
  }
  if (!model) {
    out(t(lang, 'onboard.aborted'));
    return 1;
  }
  const ref = `${tpl.id}:${model}`;
  setConfigValue(app.paths.config, 'model.default', ref);
  out(pc.green(t(lang, 'onboard.saved', { model: ref })));

  // 5) approval mode
  const modes = ['ask', 'allowlist', 'yolo'] as const;
  let approval =
    opts.approval && (modes as readonly string[]).includes(opts.approval)
      ? opts.approval
      : undefined;
  if (!approval && interactive) {
    const a = await p.ask(`${t(lang, 'onboard.approval.title')} [1]: `, '1');
    approval = modes[Math.min(Math.max(Number.parseInt(a, 10) || 1, 1), 3) - 1];
  }
  if (approval && approval !== app.config.agent.approvalMode)
    setConfigValue(app.paths.config, 'agent.approvalMode', approval);

  // 6) quick test
  if (!opts.test === false) {
    out(pc.dim(t(lang, 'onboard.test')));
    try {
      const provider = instantiateProvider(resolved);
      const res = await collectChat(
        provider.chat({
          model,
          messages: [
            {
              role: 'user',
              content:
                lang === 'ar'
                  ? 'قل مرحباً في جملة واحدة قصيرة.'
                  : 'Say hello in one short sentence.',
            },
          ],
          // reasoning models (gpt-oss, qwen3) spend tokens thinking before answering
          maxTokens: 600,
        }),
      );
      if (res.error) throw res.error;
      const firstLine =
        res.text
          .trim()
          .split('\n')
          .find((l) => l.trim()) ?? '';
      out(
        t(lang, 'onboard.test.reply', {
          text:
            firstLine ||
            (lang === 'ar'
              ? '(ردّ فارغ — جرّب نموذجاً آخر إن تكرر)'
              : '(empty reply — try another model if it repeats)'),
        }),
      );
    } catch (err) {
      out(pc.yellow(t(lang, 'onboard.key.fail', { error: (err as Error).message })));
    }
  }
  out();
  out(pc.bold(pc.green(t(lang, 'onboard.done'))));
  return 0;
}
