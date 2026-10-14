import pc from 'picocolors';
import { t, type AgentEvent, type ApprovalRequest, type Lang } from '@sindar/core';

export interface ChatView {
  onEvent(ev: AgentEvent): void;
  /** Close any open text line (call after a turn finishes). */
  flush(): void;
  approvalText(req: ApprovalRequest): string;
}

/** Streams agent events to a terminal: text inline, tool activity as dim status lines. */
export function createChatView(
  lang: Lang,
  out: NodeJS.WritableStream = process.stdout,
  opts: { quiet?: boolean; color?: boolean; reasoning?: boolean } = {},
): ChatView {
  const color = opts.color ?? Boolean((out as NodeJS.WriteStream).isTTY);
  const c = {
    dim: (s: string) => (color ? pc.dim(s) : s),
    yellow: (s: string) => (color ? pc.yellow(s) : s),
    red: (s: string) => (color ? pc.red(s) : s),
    cyan: (s: string) => (color ? pc.cyan(s) : s),
  };
  let atLineStart = true;
  let reasoningShown = false;
  let progressLine = '';
  const write = (s: string) => {
    out.write(s);
    atLineStart = s.endsWith('\n');
  };
  const clearProgress = () => {
    if (progressLine) {
      out.write('\r\x1b[2K');
      progressLine = '';
    }
  };
  const status = (s: string) => {
    clearProgress();
    if (!atLineStart) write('\n');
    write(`${s}\n`);
  };
  const firstLine = (s: string, max = 100) => {
    const line = s.split('\n').find((l) => l.trim()) ?? '';
    return line.length > max ? `${line.slice(0, max)}…` : line;
  };

  return {
    onEvent(ev) {
      switch (ev.type) {
        case 'text':
          if (reasoningShown) {
            write('\n');
            reasoningShown = false;
          }
          clearProgress();
          write(ev.delta);
          break;
        case 'reasoning':
          if (opts.reasoning && !opts.quiet) {
            if (!reasoningShown && !atLineStart) write('\n');
            reasoningShown = true;
            write(c.dim(ev.delta));
          } else if (color && !progressLine) {
            // Hidden by default (it is usually English and noisy): show a one-line indicator.
            progressLine = 'thinking';
            out.write(`\r\x1b[2K${c.dim(`💭 ${t(lang, 'chat.thinking')}`)}`);
          }
          break;
        case 'tool_start':
          status(c.cyan(t(lang, 'chat.tool.run', { summary: ev.summary })));
          break;
        case 'tool_progress':
          if (color) {
            progressLine = ev.line;
            out.write(`\r\x1b[2K${c.dim(`  ${ev.line.slice(0, 100)}`)}`);
          }
          break;
        case 'tool_end': {
          const name = ev.call.name;
          if (ev.result.isError)
            status(
              c.yellow(t(lang, 'chat.tool.error', { name, error: firstLine(ev.result.content) })),
            );
          else
            status(
              c.dim(
                `${t(lang, 'chat.tool.done', { name, ms: ev.ms })}${opts.quiet ? '' : `  ${firstLine(ev.result.content, 80)}`}`,
              ),
            );
          break;
        }
        case 'tool_denied':
          status(
            c.red(
              t(lang, 'chat.tool.denied', {
                summary: ev.summary,
                reason:
                  ev.reason === 'user'
                    ? t(lang, 'common.no')
                    : ev.reason === 'repeat'
                      ? t(lang, 'chat.tool.repeat')
                      : t(lang, 'chat.tool.forbidden'),
              }),
            ),
          );
          break;
        case 'model_switch':
          status(
            c.yellow(
              t(lang, 'chat.model.switch', {
                from: ev.from,
                to: ev.to,
                reason: firstLine(ev.reason, 80),
              }),
            ),
          );
          break;
        case 'compress':
          status(
            c.dim(t(lang, 'chat.compress', { before: ev.beforeTokens, after: ev.afterTokens })),
          );
          break;
        case 'notice':
          status(c.yellow(ev.message));
          break;
        case 'retry_wait':
          status(
            c.yellow(
              t(lang, 'chat.retry.wait', {
                model: ev.model,
                seconds: ev.seconds,
                attempt: ev.attempt,
              }),
            ),
          );
          break;
        case 'error':
          // Printed once by the command (which also has the i18n-friendly wording); just end the line.
          clearProgress();
          if (!atLineStart) write('\n');
          break;
        case 'done':
          if (ev.finishReason === 'cancelled') status(c.yellow(t(lang, 'chat.cancelled')));
          else if (!atLineStart) write('\n');
          break;
        default:
          break;
      }
    },
    flush() {
      clearProgress();
      if (!atLineStart) write('\n');
    },
    approvalText(req) {
      const key = `chat.approve.reason.${req.decision.reason}`;
      const known = [
        'chat.approve.reason.exec',
        'chat.approve.reason.write-outside',
        'chat.approve.reason.pipe-to-shell',
      ];
      const reason = known.includes(key)
        ? t(lang, key as 'chat.approve.reason.exec')
        : req.decision.reason;
      return [
        c.yellow(t(lang, 'chat.approve.title')),
        `  ${c.cyan(req.decision.summary)}`,
        `  ${c.dim(reason)}`,
      ].join('\n');
    },
  };
}
