import { useState } from 'preact/hooks';
import type { ApprovalItem, AssistantItem, NoticeItem, ToolItem, UserItem } from '../lib/store.ts';
import { answerApproval, getApi, lang, showReasoning, showToast } from '../lib/store.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { t } from '../lib/i18n.ts';

const TOOL_ICONS: Record<string, string> = {
  read_file: '📄',
  write_file: '✍️',
  edit_file: '✏️',
  list_dir: '📁',
  search_files: '🔎',
  terminal: '⌨️',
  process: '⚙️',
  web_fetch: '🌐',
  web_search: '🔍',
  make_pdf: '📕',
};

export function UserBubble({ item }: { item: UserItem }) {
  return (
    <div class="row user">
      <div class="bubble user" dir="auto">
        {item.text}
      </div>
    </div>
  );
}

export function AssistantBubble({ item }: { item: AssistantItem }) {
  const l = lang.value;
  const text = item.text.value;
  const streaming = item.streaming.value;
  const reasoning = item.reasoning.value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t(l, 'chat.copied'));
    } catch {
      /* ignore */
    }
  };
  if (!text && !streaming && !reasoning) return null;
  return (
    <div class="row assistant">
      <div class="avatar">✦</div>
      <div class="bubble assistant">
        {reasoning && showReasoning.value && (
          <details class="reasoning" open={streaming && !text}>
            <summary>💭 {t(l, 'chat.thinking')}</summary>
            <pre dir="auto">{reasoning}</pre>
          </details>
        )}
        {text ? (
          <div class="md" dir="auto" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
        ) : streaming ? (
          <div class="thinking">
            <span class="dots">
              <i />
              <i />
              <i />
            </span>
            {reasoning ? ` 💭 ${t(l, 'chat.thinking')}` : ''}
          </div>
        ) : null}
        {!streaming && text && (
          <button class="icon-btn copy" title={t(l, 'chat.copy')} onClick={copy}>
            ⧉
          </button>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ToolCard({ item }: { item: ToolItem }) {
  const l = lang.value;
  const [open, setOpen] = useState(false);
  const status = item.status.value;
  const output = item.output.value;
  const progress = item.progress.value;
  const ms = item.ms.value;
  const files = item.files.value;
  const api = getApi();
  const label =
    status === 'running'
      ? t(l, 'tool.running')
      : status === 'done'
        ? t(l, 'tool.done')
        : status === 'error'
          ? t(l, 'tool.error')
          : item.reason === 'repeat'
            ? t(l, 'tool.repeat')
            : t(l, 'tool.denied');
  return (
    <div class={`tool ${status}`}>
      <button class="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class="tool-icon">{TOOL_ICONS[item.name] ?? '🔧'}</span>
        <span class="tool-summary" dir="ltr">
          {item.summary}
        </span>
        <span class={`tool-status ${status}`}>
          {status === 'running' && <span class="spinner" />}
          {label}
          {ms !== undefined && status !== 'running' ? ` · ${t(l, 'tool.ms', { ms })}` : ''}
        </span>
      </button>
      {status === 'running' && progress && (
        <div class="tool-progress" dir="ltr">
          {progress}
        </div>
      )}
      {files.length > 0 && api && (
        <div class="tool-files">
          {files.map((f) => (
            <div class="tool-file" key={f.path}>
              <span class="tool-file-name" dir="auto" title={f.path}>
                📎 {f.name}
                {f.bytes !== undefined ? (
                  <span class="muted small"> · {formatBytes(f.bytes)}</span>
                ) : null}
              </span>
              <a class="btn small" href={api.fileUrl(f.path)} target="_blank" rel="noopener">
                {t(l, 'tool.open')}
              </a>
              <a class="btn small" href={api.fileUrl(f.path, true)} download={f.name}>
                {t(l, 'tool.download')}
              </a>
            </div>
          ))}
        </div>
      )}
      {open && (
        <div class="tool-body">
          <div class="tool-label">{t(l, 'approval.args')}</div>
          <pre dir="ltr">{item.args}</pre>
          {output && (
            <>
              <div class="tool-label">
                {status === 'error' || status === 'denied' ? t(l, 'tool.error') : 'Output'}
              </div>
              <pre dir="auto" class="tool-output">
                {output}
              </pre>
              {item.truncated && <div class="muted small">{t(l, 'tool.truncated')}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ApprovalCard({ item }: { item: ApprovalItem }) {
  const l = lang.value;
  const a = item.approval.value;
  const [showArgs, setShowArgs] = useState(false);
  const riskKey =
    a.risk === 'exec'
      ? 'approval.risk.exec'
      : a.risk === 'write'
        ? 'approval.risk.write'
        : a.risk === 'network'
          ? 'approval.risk.network'
          : 'approval.risk.read';
  return (
    <div class={`approval ${a.answer ? `answered ${a.answer}` : 'pending'}`}>
      <div class="approval-head">
        <span class="approval-icon">{a.answer ? (a.answer === 'deny' ? '⛔' : '✅') : '🔐'}</span>
        <div>
          <div class="approval-title">
            {a.answer ? t(l, `approval.answered.${a.answer}` as const) : t(l, 'approval.title')}
          </div>
          <div class="muted small">
            {t(l, riskKey)} · {t(l, 'approval.tool')}: <code>{a.tool}</code>
          </div>
        </div>
      </div>
      <pre class="approval-summary" dir="ltr">
        {a.summary}
      </pre>
      <button class="btn link small" onClick={() => setShowArgs(!showArgs)}>
        {showArgs ? t(l, 'tool.hide') : t(l, 'approval.args')}
      </button>
      {showArgs && (
        <pre dir="ltr" class="small">
          {a.args}
        </pre>
      )}
      {!a.answer && (
        <div class="approval-actions">
          <button class="btn primary" onClick={() => answerApproval(a.id, 'allow')}>
            {t(l, 'approval.allow')}
          </button>
          <button class="btn" onClick={() => answerApproval(a.id, 'always')}>
            {t(l, 'approval.always')}
          </button>
          <button class="btn danger" onClick={() => answerApproval(a.id, 'deny')}>
            {t(l, 'approval.deny')}
          </button>
        </div>
      )}
    </div>
  );
}

export function NoticeLine({ item }: { item: NoticeItem }) {
  return (
    <div class={`notice ${item.level}`} dir="auto">
      {item.text}
    </div>
  );
}
