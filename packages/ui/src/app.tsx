import { useEffect, useState } from 'preact/hooks';
import {
  applyLang,
  applyTheme,
  authed,
  conn,
  connect,
  currentModel,
  currentSession,
  isRunning,
  lang,
  modelPickerOpen,
  pending,
  sidebarOpen,
  socketStatus,
  toast,
  undoLast,
  wakeSocket,
  openSession,
  currentId,
  staleUi,
  reloadApp,
  stalled,
  config,
} from './lib/store.ts';
import { normalizeUrl } from './lib/api.ts';
import { t } from './lib/i18n.ts';
import { ConnectScreen } from './components/ConnectScreen.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { ChatView } from './components/ChatView.tsx';
import { Composer } from './components/Composer.tsx';
import { ModelPicker } from './components/ModelPicker.tsx';
import { Settings } from './components/Settings.tsx';
import { MemoryPanel } from './components/MemoryPanel.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { ChannelsPanel } from './components/ChannelsPanel.tsx';

/** Token handed over in the URL (`sindar dashboard` prints such a link). */
function takeTokenFromUrl(): { token?: string; url?: string } {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') ?? undefined;
  const url = params.get('gateway') ?? undefined;
  if (token || url) {
    params.delete('token');
    params.delete('gateway');
    const qs = params.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  }
  return { token, url };
}

export function App() {
  const [boot, setBoot] = useState<'init' | 'ready'>('init');
  const [handoff] = useState(takeTokenFromUrl);

  useEffect(() => {
    applyTheme();
    applyLang();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => applyTheme();
    mq.addEventListener('change', onMq);
    const onVis = () => {
      if (document.visibilityState === 'visible') wakeSocket();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', wakeSocket);

    (async () => {
      const saved = conn.value;
      const candidate = handoff.token
        ? { url: normalizeUrl(handoff.url ?? location.origin), token: handoff.token }
        : saved;
      if (candidate) {
        try {
          await connect(candidate);
        } catch {
          /* show the connect screen */
        }
      }
      setBoot('ready');
    })();
    return () => {
      mq.removeEventListener('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', wakeSocket);
    };
  }, []);

  if (boot === 'init') return <div class="boot" />;
  if (!authed.value) {
    return (
      <ConnectScreen initialUrl={conn.value?.url ?? handoff.url} initialToken={handoff.token} />
    );
  }
  return <Shell />;
}

function Shell() {
  const l = lang.value;
  const status = socketStatus.value;
  const title = currentSession.value?.title || t(l, 'app.name');
  const otherPending = pending.value.filter((p) => p.sessionId !== currentId.value);
  return (
    <div class="shell">
      <header class="topbar">
        <button
          class="icon-btn"
          onClick={() => (sidebarOpen.value = true)}
          aria-label={t(l, 'common.menu')}
        >
          ☰
        </button>
        <div class="title" dir="auto">
          <div class="title-main">{title}</div>
          <button class="title-sub" onClick={() => (modelPickerOpen.value = true)} dir="ltr">
            <span
              class={`dot ${status === 'open' ? 'ok' : status === 'connecting' ? 'warn' : 'bad'}`}
            />
            {currentModel.value || t(l, 'chat.model')}
            {isRunning.value ? ` · ${t(l, 'status.running')}` : ''}
          </button>
        </div>
        {currentId.value && !isRunning.value && (
          <button
            class="icon-btn"
            onClick={() => void undoLast()}
            title={t(l, 'chat.undo')}
            aria-label={t(l, 'chat.undo')}
          >
            ↶
          </button>
        )}
        <button
          class="icon-btn"
          onClick={() => openSession(undefined)}
          title={t(l, 'sessions.new')}
          aria-label={t(l, 'sessions.new')}
        >
          ＋
        </button>
      </header>
      {status !== 'open' && <div class="banner warn">{t(l, 'offline.banner')}</div>}
      {staleUi.value && (
        <button class="banner info" onClick={reloadApp}>
          ⬆️ {t(l, 'update.banner')}
        </button>
      )}
      {stalled.value && config.value?.platform.isTermux && (
        <div class="banner warn">⏳ {t(l, 'stalled.banner')}</div>
      )}
      {otherPending.length > 0 && (
        <button class="banner info" onClick={() => openSession(otherPending[0]!.sessionId)}>
          🔐 {t(l, 'approval.pending.other')}
        </button>
      )}
      <ChatView />
      <Composer />
      <Sidebar />
      <ModelPicker />
      <Settings />
      <MemoryPanel />
      <SkillsPanel />
      <ChannelsPanel />
      {toast.value && <div class="toast">{toast.value}</div>}
    </div>
  );
}
