/**
 * Bridge to the Android shell (apps/android): it injects `window.SindarNative` into the WebView.
 * Everything here is optional — in a normal browser / PWA none of it exists.
 */
export interface SindarNative {
  version(): string;
  lang(): string;
  getConnection(): string | null;
  saveConnection(url: string, token: string): boolean;
  forget(): void;
  startBrain(): void;
  openTermux(): void;
  retry(): void;
  ping(): void;
  termuxInstalled(): boolean;
  localUrl(): string;
}

declare global {
  interface Window {
    SindarNative?: SindarNative;
  }
}

export function native(): SindarNative | undefined {
  return typeof window === 'undefined' ? undefined : window.SindarNative;
}

/** True when the brain is on this very phone (so "start the brain" via Termux makes sense). */
export function isLocalBrain(url: string | undefined): boolean {
  return Boolean(url && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url));
}

/** Text handed over by the app (share sheet) through `?draft=`; removed from the address. */
export function takeDraftFromUrl(): string | undefined {
  if (typeof location === 'undefined') return undefined;
  const params = new URLSearchParams(location.search);
  const draft = params.get('draft');
  if (draft === null) return undefined;
  params.delete('draft');
  const qs = params.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  return draft.trim() || undefined;
}
