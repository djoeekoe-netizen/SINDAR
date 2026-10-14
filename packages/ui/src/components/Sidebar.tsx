import { useEffect, useRef, useState } from 'preact/hooks';
import type { SearchResultDTO } from '../../../gateway/src/protocol.ts';
import {
  currentId,
  deleteSession,
  getApi,
  lang,
  memoryOpen,
  channelsOpen,
  newChat,
  openSession,
  pending,
  running,
  sessions,
  settingsOpen,
  sidebarOpen,
  skillsOpen,
} from '../lib/store.ts';
import { relTime, t } from '../lib/i18n.ts';

/** `[match]` markers from the gateway → <mark>. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <span dir="auto">
      {parts.map((p, i) =>
        p.startsWith('[') && p.endsWith(']') && p.length > 2 ? (
          <mark key={i}>{p.slice(1, -1)}</mark>
        ) : (
          p
        ),
      )}
    </span>
  );
}

export function Sidebar() {
  const l = lang.value;
  const list = sessions.value;
  const open = sidebarOpen.value;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultDTO[] | undefined>();
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults(undefined);
      return;
    }
    timer.current = setTimeout(() => {
      const api = getApi();
      if (!api) return;
      setSearching(true);
      api
        .search(q, 15)
        .then((r) => setResults(r.results))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const pick = (id: string) => {
    void openSession(id);
    sidebarOpen.value = false;
  };

  return (
    <>
      <div class={`scrim ${open ? 'show' : ''}`} onClick={() => (sidebarOpen.value = false)} />
      <aside class={`sidebar ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div class="sidebar-head">
          <strong>{t(l, 'sessions.title')}</strong>
          <button
            class="icon-btn"
            onClick={() => (sidebarOpen.value = false)}
            aria-label={t(l, 'common.close')}
          >
            ✕
          </button>
        </div>
        <button class="btn primary wide" onClick={newChat}>
          ＋ {t(l, 'sessions.new')}
        </button>
        <div class="search">
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autocomplete="off"
            dir="auto"
            value={query}
            placeholder={t(l, 'search.placeholder')}
            aria-label={t(l, 'search.placeholder')}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          {query && (
            <button class="icon-btn" onClick={() => setQuery('')} aria-label={t(l, 'search.clear')}>
              ✕
            </button>
          )}
        </div>
        {results !== undefined ? (
          <div class="session-list search-results">
            <div class="muted small pad">
              {searching
                ? '…'
                : results.length === 0
                  ? t(l, 'search.none', { q: query.trim() })
                  : t(l, 'search.title')}
            </div>
            {results.map((r) => (
              <button
                key={r.session.id}
                class="session-main hit"
                onClick={() => pick(r.session.id)}
              >
                <div class="session-title" dir="auto">
                  {r.session.title || t(l, 'sessions.untitled')}
                </div>
                <div class="session-meta muted small">
                  {relTime(l, r.session.updatedAt)} ·{' '}
                  {t(l, 'sessions.msgs', { n: r.session.messageCount ?? 0 })}
                </div>
                {r.hits.slice(0, 2).map((h) => (
                  <div key={h.seq} class="hit-snippet small">
                    <span class="muted">{h.role === 'user' ? '👤' : '🤖'}</span>{' '}
                    <Snippet text={h.snippet} />
                  </div>
                ))}
              </button>
            ))}
          </div>
        ) : (
          <div class="session-list">
            {list.length === 0 && <div class="muted small pad">{t(l, 'sessions.empty')}</div>}
            {list.map((s) => {
              const isCur = s.id === currentId.value;
              const isRun = running.value.has(s.id);
              const hasPending = pending.value.some((p) => p.sessionId === s.id);
              return (
                <div key={s.id} class={`session ${isCur ? 'current' : ''}`}>
                  <button class="session-main" onClick={() => openSession(s.id)}>
                    <div class="session-title" dir="auto">
                      {hasPending ? '🔐 ' : isRun ? '⏳ ' : ''}
                      {s.channel === 'telegram' ? '✈️ ' : ''}
                      {s.title || t(l, 'sessions.untitled')}
                    </div>
                    <div class="session-meta muted small">
                      {relTime(l, s.updatedAt)} ·{' '}
                      {t(l, 'sessions.msgs', { n: s.messageCount ?? 0 })}
                      {s.model ? ` · ${s.model.split(':').pop()}` : ''}
                    </div>
                    {s.lastMessage && (
                      <div class="session-preview muted small" dir="auto">
                        {s.lastMessage}
                      </div>
                    )}
                  </button>
                  <button
                    class="icon-btn danger"
                    title={t(l, 'sessions.delete')}
                    aria-label={t(l, 'sessions.delete')}
                    onClick={() => {
                      if (confirm(t(l, 'sessions.delete.confirm'))) void deleteSession(s.id);
                    }}
                  >
                    🗑
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div class="sidebar-foot">
          <div class="sidebar-tools">
            <button
              class="btn"
              onClick={() => {
                sidebarOpen.value = false;
                memoryOpen.value = true;
              }}
            >
              🧠 {t(l, 'sidebar.memory')}
            </button>
            <button
              class="btn"
              onClick={() => {
                sidebarOpen.value = false;
                skillsOpen.value = true;
              }}
            >
              📘 {t(l, 'sidebar.skills')}
            </button>
            <button
              class="btn"
              onClick={() => {
                sidebarOpen.value = false;
                channelsOpen.value = true;
              }}
            >
              ✈️ {t(l, 'sidebar.channels')}
            </button>
          </div>
          <button
            class="btn wide"
            onClick={() => {
              sidebarOpen.value = false;
              settingsOpen.value = true;
            }}
          >
            ⚙ {t(l, 'settings.title')}
          </button>
        </div>
      </aside>
    </>
  );
}
