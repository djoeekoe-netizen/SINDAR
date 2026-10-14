import { useEffect, useRef, useState } from 'preact/hooks';
import { items, lang, loadingHistory, sendMessage, currentId, isRunning } from '../lib/store.ts';
import { ApprovalCard, AssistantBubble, NoticeLine, ToolCard, UserBubble } from './Items.tsx';
import { t } from '../lib/i18n.ts';

export function ChatView() {
  const l = lang.value;
  const list = items.value;
  const scroller = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true); // "stuck to bottom"
  const lastLen = useRef(0);

  // Follow the stream while the user is at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stuck || list.length !== lastLen.current) {
      if (stuck) el.scrollTop = el.scrollHeight;
    }
    lastLen.current = list.length;
  });

  // Re-scroll on streaming updates (signals inside items don't change `list` identity).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const obs = new MutationObserver(() => {
      if (stuck) el.scrollTop = el.scrollHeight;
    });
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [stuck]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom !== stuck) setStuck(atBottom);
  };

  const suggestions = [
    'chat.suggest.1',
    'chat.suggest.2',
    'chat.suggest.3',
    'chat.suggest.4',
  ] as const;

  return (
    <div class="chat-wrap">
      <div class="chat" ref={scroller} onScroll={onScroll}>
        {list.length === 0 && !loadingHistory.value && !currentId.value && (
          <div class="empty">
            <img src="/icons/icon-192.png" alt="" width="72" height="72" />
            <h2>{t(l, 'chat.empty.title')}</h2>
            <p class="muted">{t(l, 'chat.empty.body')}</p>
            <div class="suggestions">
              {suggestions.map((k) => (
                <button
                  key={k}
                  class="chip"
                  onClick={() => sendMessage(t(l, k))}
                  disabled={isRunning.value}
                >
                  {t(l, k)}
                </button>
              ))}
            </div>
          </div>
        )}
        {loadingHistory.value && list.length === 0 && (
          <div class="thinking center">
            <span class="dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
        {list.map((it) => {
          switch (it.kind) {
            case 'user':
              return <UserBubble key={it.id} item={it} />;
            case 'assistant':
              return <AssistantBubble key={it.id} item={it} />;
            case 'tool':
              return <ToolCard key={it.id} item={it} />;
            case 'approval':
              return <ApprovalCard key={it.id} item={it} />;
            case 'notice':
              return <NoticeLine key={it.id} item={it} />;
            default:
              return null;
          }
        })}
        <div class="chat-end" />
      </div>
      {!stuck && (
        <button
          class="jump"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
            setStuck(true);
          }}
        >
          ↓ {t(l, 'chat.scroll.bottom')}
        </button>
      )}
    </div>
  );
}
