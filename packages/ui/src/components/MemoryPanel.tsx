import { useEffect, useState } from 'preact/hooks';
import type { MemoryFileDTO } from '../../../gateway/src/protocol.ts';
import { getApi, lang, memoryOpen, showToast } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';

type Target = MemoryFileDTO['target'];
const TABS: Target[] = ['user', 'memory', 'soul'];

export function MemoryPanel() {
  const l = lang.value;
  const [files, setFiles] = useState<MemoryFileDTO[]>([]);
  const [tab, setTab] = useState<Target>('user');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const open = memoryOpen.value;

  const load = async () => {
    const api = getApi();
    if (!api) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.memory();
      setFiles(r.files);
      setDraft(Object.fromEntries(r.files.map((f) => [f.target, f.content])));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  if (!open) return null;
  const file = files.find((f) => f.target === tab);
  const text = draft[tab] ?? '';
  const dirty = file !== undefined && text !== file.content;
  const close = () => {
    if (dirty && !confirm(t(l, 'memory.unsaved'))) return;
    memoryOpen.value = false;
  };
  const save = async () => {
    const api = getApi();
    if (!api || !file) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.saveMemory(tab, text);
      setFiles((prev) => prev.map((f) => (f.target === tab ? r.file : f)));
      showToast(t(l, 'memory.saved'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="modal-scrim" onClick={close}>
      <div class="modal tall" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <strong>🧠 {t(l, 'memory.title')}</strong>
          <button class="icon-btn" onClick={close} aria-label={t(l, 'common.close')}>
            ✕
          </button>
        </div>
        <div class="modal-body memory">
          <p class="muted small">{t(l, 'memory.intro')}</p>
          <div class="seg tabs">
            {TABS.map((x) => (
              <button key={x} class={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
                {t(l, `memory.tab.${x}` as const)}
              </button>
            ))}
          </div>
          {file && (
            <div class="muted small memory-stats" dir="auto">
              {file.limit
                ? t(l, 'memory.stats', {
                    entries: file.entries,
                    chars: text.length,
                    limit: file.limit,
                  })
                : t(l, 'memory.stats.nolimit', { chars: text.length })}
              {' · '}
              <code dir="ltr">{file.path}</code>
            </div>
          )}
          <textarea
            class="memory-editor"
            dir="auto"
            value={text}
            disabled={busy || !file}
            placeholder={t(l, `memory.hint.${tab}` as const)}
            onInput={(e) => setDraft({ ...draft, [tab]: (e.target as HTMLTextAreaElement).value })}
          />
          {error && <div class="notice error">{error}</div>}
          <div class="actions">
            <button class="btn primary" onClick={() => void save()} disabled={busy || !dirty}>
              {t(l, 'memory.save')}
            </button>
            <button class="btn" onClick={() => void load()} disabled={busy}>
              {t(l, 'memory.reload')}
            </button>
          </div>
          <p class="muted small">{t(l, `memory.hint.${tab}` as const)}</p>
        </div>
      </div>
    </div>
  );
}
