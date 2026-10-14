import { useState } from 'preact/hooks';
import {
  currentModel,
  getApi,
  lang,
  modelPickerOpen,
  models,
  refreshModels,
  saveConfig,
  setSessionModel,
  showToast,
  friendlyError,
} from '../lib/store.ts';
import { t } from '../lib/i18n.ts';

export function ModelPicker() {
  const l = lang.value;
  const data = models.value;
  const [custom, setCustom] = useState('');
  const [remote, setRemote] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<string | undefined>(undefined);
  const [makeDefault, setMakeDefault] = useState(false);
  if (!modelPickerOpen.value) return null;

  const close = () => (modelPickerOpen.value = false);
  const choose = async (ref: string) => {
    await setSessionModel(ref);
    if (makeDefault) await saveConfig({ 'model.default': ref });
    close();
  };
  const fetchList = async (provider: string) => {
    const api = getApi();
    if (!api) return;
    setLoading(provider);
    try {
      const r = await api.providerModels(provider);
      setRemote({ ...remote, [provider]: r.models });
    } catch (err) {
      showToast(friendlyError((err as Error).message));
    } finally {
      setLoading(undefined);
    }
  };

  const curProvider = currentModel.value.split(':')[0];
  const rank = (p: { id: string; kind: string }) =>
    p.id === curProvider ? 0 : p.kind === 'mock' ? 2 : 1;
  const ready = (data?.providers ?? [])
    .filter((p) => p.configured && p.enabled)
    .sort((a, b) => rank(a) - rank(b));
  const others = (data?.providers ?? []).filter((p) => !(p.configured && p.enabled));

  return (
    <div class="modal-scrim" onClick={close}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <strong>{t(l, 'models.title')}</strong>
          <button class="icon-btn" onClick={close} aria-label={t(l, 'common.close')}>
            ✕
          </button>
        </div>
        <div class="muted small">
          {t(l, 'chat.model')}: <code>{currentModel.value}</code>
        </div>
        <label class="check">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(e) => setMakeDefault((e.target as HTMLInputElement).checked)}
          />
          {t(l, 'models.set.default')}
        </label>
        <div class="modal-body">
          {!data && (
            <button class="btn" onClick={() => void refreshModels()}>
              {t(l, 'models.loading')}
            </button>
          )}
          {ready.map((p) => {
            const list = remote[p.id] ?? p.suggested;
            return (
              <div key={p.id} class="provider">
                <div class="provider-head">
                  <strong>{p.name}</strong>
                  <span class="tag ok">{t(l, 'models.ready')}</span>
                  <span class="tag">{t(l, `models.${p.free}` as 'models.free')}</span>
                  {p.kind !== 'mock' && (
                    <button
                      class="btn link small"
                      onClick={() => void fetchList(p.id)}
                      disabled={loading === p.id}
                    >
                      {loading === p.id ? t(l, 'models.loading') : t(l, 'models.fetch')}
                    </button>
                  )}
                </div>
                {p.notes && <div class="muted small">{p.notes}</div>}
                <div class="model-list">
                  {list.map((m) => {
                    const ref = `${p.id}:${m}`;
                    const cur = ref === currentModel.value;
                    return (
                      <button
                        key={ref}
                        class={`model ${cur ? 'current' : ''}`}
                        onClick={() => void choose(ref)}
                        dir="ltr"
                      >
                        {m}
                        {p.suggested.includes(m) ? ' ★' : ''}
                      </button>
                    );
                  })}
                  {list.length === 0 && <div class="muted small">—</div>}
                </div>
              </div>
            );
          })}
          <div class="custom">
            <div class="muted small">{t(l, 'models.custom')}</div>
            <div class="inline">
              <input
                dir="ltr"
                value={custom}
                placeholder="groq:openai/gpt-oss-120b"
                onInput={(e) => setCustom((e.target as HTMLInputElement).value)}
              />
              <button
                class="btn primary"
                disabled={!custom.includes(':')}
                onClick={() => void choose(custom.trim())}
              >
                {t(l, 'models.use')}
              </button>
            </div>
          </div>
          {others.length > 0 && (
            <details class="others">
              <summary class="muted small">
                {t(l, 'models.nokey')} ({others.length})
              </summary>
              <ul class="muted small">
                {others.map((p) => (
                  <li key={p.id}>
                    {p.name} — {t(l, `models.${p.free}` as 'models.free')}
                    {p.signupUrl ? (
                      <>
                        {' '}
                        ·{' '}
                        <a href={p.signupUrl} target="_blank" rel="noopener">
                          {p.signupUrl.replace(/^https?:\/\//, '')}
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div class="muted small">sindar onboard --provider &lt;id&gt;</div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
