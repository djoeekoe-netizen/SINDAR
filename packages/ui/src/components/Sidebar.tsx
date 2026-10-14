import {
  currentId,
  deleteSession,
  lang,
  newChat,
  openSession,
  pending,
  running,
  sessions,
  settingsOpen,
  sidebarOpen,
} from '../lib/store.ts';
import { relTime, t } from '../lib/i18n.ts';

export function Sidebar() {
  const l = lang.value;
  const list = sessions.value;
  const open = sidebarOpen.value;
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
                    {s.title || t(l, 'sessions.untitled')}
                  </div>
                  <div class="session-meta muted small">
                    {relTime(l, s.updatedAt)} · {t(l, 'sessions.msgs', { n: s.messageCount ?? 0 })}
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
        <div class="sidebar-foot">
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
