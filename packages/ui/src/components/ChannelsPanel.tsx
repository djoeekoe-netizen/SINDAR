import { useEffect, useState } from 'preact/hooks';
import type { ChannelsDTO, TelegramChannelDTO } from '../../../gateway/src/protocol.ts';
import { channelsOpen, getApi, lang, showToast } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';

const REFRESH_MS = 4000;

export function ChannelsPanel() {
  const l = lang.value;
  const open = channelsOpen.value;
  const [data, setData] = useState<ChannelsDTO | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [token, setToken] = useState('');
  const [editingToken, setEditingToken] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const api = getApi();
    if (!api) return;
    try {
      setData(await api.channels());
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [open]);
  if (!open) return null;
  const close = () => (channelsOpen.value = false);
  const tg = data?.telegram;

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) showToast(okMsg);
      await load();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveToken = () =>
    run(async () => {
      const r = await getApi()!.setTelegramToken(token.trim());
      setToken('');
      setEditingToken(false);
      showToast(t(l, 'channels.tg.saved', { username: r.channels.telegram.bot?.username ?? '' }));
    });

  return (
    <div class="modal-scrim" onClick={close}>
      <div class="modal tall" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <strong>📡 {t(l, 'channels.title')}</strong>
          <button class="icon-btn" onClick={close} aria-label={t(l, 'common.close')}>
            ✕
          </button>
        </div>
        <div class="modal-body channels">
          {error && (
            <div class="notice error">
              {error}{' '}
              <button class="btn small" onClick={() => void load()}>
                {t(l, 'common.retry')}
              </button>
            </div>
          )}
          <h3>✈️ {t(l, 'channels.telegram')}</h3>
          <p class="muted">{t(l, 'channels.tg.intro')}</p>
          {tg && (!tg.configured || editingToken) && (
            <div class="card">
              <pre class="steps">{t(l, 'channels.tg.steps')}</pre>
              <label class="field">
                <span>{t(l, 'channels.tg.token')}</span>
                <input
                  type="text"
                  dir="ltr"
                  inputMode="text"
                  autoComplete="off"
                  spellcheck={false}
                  placeholder="123456789:AAH…"
                  value={token}
                  onInput={(e) => setToken((e.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <div class="row">
                <button
                  class="btn primary"
                  disabled={busy || !/^\d+:[\w-]{30,}$/.test(token.trim())}
                  onClick={() => void saveToken()}
                >
                  {busy ? t(l, 'channels.tg.saving') : t(l, 'channels.tg.save')}
                </button>
                {editingToken && (
                  <button class="btn" onClick={() => setEditingToken(false)}>
                    {t(l, 'common.cancel')}
                  </button>
                )}
              </div>
              <p class="muted small">{t(l, 'channels.tg.cli')}</p>
            </div>
          )}
          {tg && tg.configured && !editingToken && (
            <TelegramStatus
              tg={tg}
              busy={busy}
              onToggle={(enabled) =>
                run(() => getApi()!.setConfig({ 'channels.telegram.enabled': enabled }))
              }
              onRestart={() => run(() => getApi()!.restartTelegram())}
              onChangeToken={() => setEditingToken(true)}
              onStreaming={(v) =>
                run(() => getApi()!.setConfig({ 'channels.telegram.streaming': v }))
              }
              onGroups={(v) => run(() => getApi()!.setConfig({ 'channels.telegram.groups': v }))}
              onApprove={(code) =>
                run(() => getApi()!.approvePairing(code), t(l, 'channels.tg.approve') + ' ✅')
              }
              onRevoke={(id) => {
                if (confirm(t(l, 'channels.tg.revoke.confirm')))
                  void run(() => getApi()!.revokePairing(id));
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TelegramStatus(props: {
  tg: TelegramChannelDTO;
  busy: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onRestart: () => Promise<void>;
  onChangeToken: () => void;
  onStreaming: (v: boolean) => Promise<void>;
  onGroups: (v: 'mention' | 'all' | 'off') => Promise<void>;
  onApprove: (code: string) => Promise<void>;
  onRevoke: (userId: string) => void;
}) {
  const l = lang.value;
  const { tg, busy } = props;
  const state = !tg.enabled
    ? t(l, 'channels.tg.disabled')
    : tg.running
      ? t(l, 'channels.tg.running', { username: tg.bot?.username ?? '' })
      : t(l, 'channels.tg.stopped');
  return (
    <>
      <div class="card">
        <div class="row between">
          <strong>{state}</strong>
          <span class="muted small">{t(l, 'channels.tg.updates', { n: tg.updates })}</span>
        </div>
        {tg.lastError && !tg.running && (
          <div class="notice error">{t(l, 'channels.tg.error', { error: tg.lastError })}</div>
        )}
        <div class="row wrap">
          {tg.bot?.username && (
            <a
              class="btn small"
              href={`https://t.me/${tg.bot.username}`}
              target="_blank"
              rel="noreferrer"
            >
              {t(l, 'channels.tg.open')}
            </a>
          )}
          <button
            class="btn small"
            disabled={busy}
            onClick={() => void props.onToggle(!tg.enabled)}
          >
            {tg.enabled ? t(l, 'channels.tg.disable') : t(l, 'channels.tg.enable')}
          </button>
          {tg.enabled && (
            <button class="btn small" disabled={busy} onClick={() => void props.onRestart()}>
              {t(l, 'channels.tg.restart')}
            </button>
          )}
          <button class="btn small" disabled={busy} onClick={props.onChangeToken}>
            {t(l, 'channels.tg.change_token')}
          </button>
        </div>
        <label class="check">
          <input
            type="checkbox"
            checked={tg.streaming}
            disabled={busy}
            onChange={(e) => void props.onStreaming((e.currentTarget as HTMLInputElement).checked)}
          />
          <span>{t(l, 'channels.tg.streaming')}</span>
        </label>
        <label class="field inline">
          <span>{t(l, 'channels.tg.groups')}</span>
          <select
            value={tg.groups}
            disabled={busy}
            onChange={(e) =>
              void props.onGroups(
                (e.currentTarget as HTMLSelectElement).value as 'mention' | 'all' | 'off',
              )
            }
          >
            <option value="mention">{t(l, 'channels.tg.groups.mention')}</option>
            <option value="all">{t(l, 'channels.tg.groups.all')}</option>
            <option value="off">{t(l, 'channels.tg.groups.off')}</option>
          </select>
        </label>
      </div>

      <h4>🔑 {t(l, 'channels.tg.pending')}</h4>
      <p class="muted small">{t(l, 'channels.tg.pair.hint')}</p>
      {tg.pending.length === 0 && (
        <div class="muted small pad">{t(l, 'channels.tg.pending.none')}</div>
      )}
      {tg.pending.map((p) => (
        <div key={p.userId} class="list-row">
          <div class="grow">
            <div dir="auto">{p.displayName ?? p.userId}</div>
            <div class="muted small" dir="ltr">
              {p.code} · {p.userId}
            </div>
          </div>
          <button
            class="btn small primary"
            disabled={busy}
            onClick={() => void props.onApprove(p.code ?? '')}
          >
            {t(l, 'channels.tg.approve')}
          </button>
        </div>
      ))}

      <h4>👥 {t(l, 'channels.tg.approved')}</h4>
      {tg.approved.length === 0 && (
        <div class="muted small pad">{t(l, 'channels.tg.approved.none')}</div>
      )}
      {tg.approved.map((p) => (
        <div key={p.userId} class="list-row">
          <div class="grow">
            <div dir="auto">{p.displayName ?? p.userId}</div>
            <div class="muted small" dir="ltr">
              {p.userId}
            </div>
          </div>
          <button class="btn small danger" disabled={busy} onClick={() => props.onRevoke(p.userId)}>
            {t(l, 'channels.tg.revoke')}
          </button>
        </div>
      ))}
    </>
  );
}
