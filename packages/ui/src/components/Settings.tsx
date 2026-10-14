import { useState } from 'preact/hooks';
import {
  config,
  conn,
  disconnect,
  lang,
  saveConfig,
  setLocalLang,
  setShowReasoning,
  setTheme,
  settingsOpen,
  showReasoning,
  theme,
  version,
} from '../lib/store.ts';
import { t, type Lang } from '../lib/i18n.ts';

export function Settings() {
  const l = lang.value;
  const cfg = config.value;
  const [model, setModel] = useState(cfg?.model.default ?? '');
  const [fallbacks, setFallbacks] = useState((cfg?.model.fallbacks ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  if (!settingsOpen.value) return null;
  const close = () => (settingsOpen.value = false);

  const changeLang = async (next: Lang) => {
    setLocalLang(next);
    await saveConfig({ 'ui.language': next });
  };
  const changeApproval = async (mode: string) => {
    await saveConfig({ 'agent.approvalMode': mode });
  };
  const saveModels = async () => {
    setSaving(true);
    const list = fallbacks
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const patch: Record<string, unknown> = { 'model.fallbacks': list };
    if (model.trim()) patch['model.default'] = model.trim();
    await saveConfig(patch);
    setSaving(false);
  };

  return (
    <div class="modal-scrim" onClick={close}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <strong>⚙ {t(l, 'settings.title')}</strong>
          <button class="icon-btn" onClick={close} aria-label={t(l, 'common.close')}>
            ✕
          </button>
        </div>
        <div class="modal-body settings">
          <section>
            <h3>{t(l, 'settings.language')}</h3>
            <div class="seg">
              <button class={l === 'ar' ? 'on' : ''} onClick={() => void changeLang('ar')}>
                العربية
              </button>
              <button class={l === 'en' ? 'on' : ''} onClick={() => void changeLang('en')}>
                English
              </button>
            </div>
          </section>
          <section>
            <h3>{t(l, 'settings.theme')}</h3>
            <div class="seg">
              {(['dark', 'light', 'system'] as const).map((m) => (
                <button key={m} class={theme.value === m ? 'on' : ''} onClick={() => setTheme(m)}>
                  {t(l, `settings.theme.${m}` as const)}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>{t(l, 'settings.approval')}</h3>
            <div class="seg vertical">
              {(['ask', 'allowlist', 'yolo'] as const).map((m) => (
                <button
                  key={m}
                  class={cfg?.approvalMode === m ? 'on' : ''}
                  onClick={() => void changeApproval(m)}
                >
                  {t(l, `settings.approval.${m}` as const)}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>{t(l, 'settings.model.default')}</h3>
            <input
              dir="ltr"
              value={model}
              onInput={(e) => setModel((e.target as HTMLInputElement).value)}
              placeholder="groq:openai/gpt-oss-120b"
            />
            <h3>{t(l, 'settings.model.fallbacks')}</h3>
            <input
              dir="ltr"
              value={fallbacks}
              onInput={(e) => setFallbacks((e.target as HTMLInputElement).value)}
              placeholder="groq:openai/gpt-oss-20b, gemini:gemini-2.5-flash"
            />
            <button class="btn primary" onClick={() => void saveModels()} disabled={saving}>
              {t(l, 'settings.save')}
            </button>
          </section>
          <section>
            <label class="check">
              <input
                type="checkbox"
                checked={showReasoning.value}
                onChange={(e) => setShowReasoning((e.target as HTMLInputElement).checked)}
              />
              {t(l, 'settings.reasoning')}
            </label>
          </section>
          <section>
            <h3>{t(l, 'settings.install')}</h3>
            <p class="muted small">{t(l, 'settings.install.hint')}</p>
          </section>
          <section>
            <h3>{t(l, 'settings.connection')}</h3>
            <div class="muted small" dir="ltr">
              {conn.value?.url}
            </div>
            {cfg && (
              <div class="muted small">
                {t(l, 'settings.workspace')}: <code dir="ltr">{cfg.workspace}</code>
              </div>
            )}
            <button class="btn danger" onClick={disconnect}>
              {t(l, 'settings.connection.change')}
            </button>
          </section>
          <section>
            <h3>{t(l, 'settings.about')}</h3>
            <p class="muted small">
              {cfg &&
                t(l, 'settings.about.body', {
                  version: version.value?.version ?? cfg.version,
                  build: (version.value?.build ?? cfg.build).slice(0, 7),
                  os: cfg.platform.os,
                  termux: cfg.platform.isTermux ? t(l, 'settings.about.termux') : '',
                  node: cfg.platform.nodeVersion,
                })}
            </p>
            <p class="muted small">
              <a href="https://github.com/djoeekoe-netizen/SINDAR" target="_blank" rel="noopener">
                github.com/djoeekoe-netizen/SINDAR
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
