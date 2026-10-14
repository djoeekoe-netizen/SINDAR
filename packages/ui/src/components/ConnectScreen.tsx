import { useState } from 'preact/hooks';
import { normalizeUrl } from '../lib/api.ts';
import { connect, connectError, lang, setLocalLang } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';

export function ConnectScreen(props: { initialUrl?: string; initialToken?: string }) {
  const l = lang.value;
  const [url, setUrl] = useState(props.initialUrl ?? location.origin);
  const [token, setToken] = useState(props.initialToken ?? '');
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await connect({ url: normalizeUrl(url), token: token.trim() });
    } catch {
      /* error shown via connectError */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="connect">
      <div class="connect-card">
        <div class="brand">
          <img src="/icons/icon-192.png" alt="" width="64" height="64" />
          <h1>{t(l, 'app.name')}</h1>
          <p class="muted">{t(l, 'app.tagline')}</p>
        </div>
        <h2>{t(l, 'connect.title')}</h2>
        <p class="muted small">{t(l, 'connect.intro')}</p>
        <form onSubmit={submit}>
          <label>
            <span>{t(l, 'connect.url')}</span>
            <input
              type="url"
              dir="ltr"
              value={url}
              onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
              placeholder="http://127.0.0.1:18789"
              autocomplete="off"
            />
          </label>
          <label>
            <span>{t(l, 'connect.token')}</span>
            <input
              type="password"
              dir="ltr"
              value={token}
              onInput={(e) => setToken((e.target as HTMLInputElement).value)}
              autocomplete="off"
              required
            />
            <small class="muted">{t(l, 'connect.token.hint')}</small>
          </label>
          {connectError.value && <div class="alert error">{connectError.value}</div>}
          <button class="btn primary wide" type="submit" disabled={busy}>
            {busy ? t(l, 'connect.connecting') : t(l, 'connect.button')}
          </button>
        </form>
        <button class="btn link" type="button" onClick={() => setShowHelp(!showHelp)}>
          {t(l, 'connect.howto')}
        </button>
        {showHelp && <pre class="help">{t(l, 'connect.howto.body')}</pre>}
        <div class="lang-switch">
          <button class={`chip ${l === 'ar' ? 'on' : ''}`} onClick={() => setLocalLang('ar')}>
            العربية
          </button>
          <button class={`chip ${l === 'en' ? 'on' : ''}`} onClick={() => setLocalLang('en')}>
            English
          </button>
        </div>
      </div>
    </div>
  );
}
