import { useEffect, useRef, useState } from 'preact/hooks';
import { cancelTurn, isRunning, lang, sendMessage, socketStatus } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';

const isTouch = () => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

export function Composer() {
  const l = lang.value;
  const [text, setText] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const running = isRunning.value;
  const offline = socketStatus.value !== 'open';

  const resize = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useEffect(resize, [text]);

  const submit = () => {
    // Read from the element so a fast Enter right after typing never sends stale state.
    const value = (ta.current?.value ?? text).trim();
    if (!value || running || offline) return;
    sendMessage(value);
    setText('');
    if (ta.current) ta.current.value = '';
    requestAnimationFrame(() => ta.current?.focus());
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch()) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div class="composer">
      <textarea
        ref={ta}
        rows={1}
        value={text}
        placeholder={t(l, 'chat.placeholder')}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={onKey}
        dir="auto"
        enterkeyhint="send"
      />
      {running ? (
        <button
          class="send stop"
          onClick={cancelTurn}
          title={t(l, 'chat.stop')}
          aria-label={t(l, 'chat.stop')}
        >
          ■
        </button>
      ) : (
        <button
          class="send"
          onClick={submit}
          disabled={!text.trim() || offline}
          title={t(l, 'chat.send')}
          aria-label={t(l, 'chat.send')}
        >
          ➤
        </button>
      )}
    </div>
  );
}
