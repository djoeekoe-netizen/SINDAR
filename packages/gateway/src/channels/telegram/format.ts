/**
 * Markdown (what models write) → Telegram HTML (the subset Telegram accepts), plus chunking
 * to the 4096-character message limit without breaking tags.
 */

export const TELEGRAM_MAX_CHARS = 4096;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text: string): string {
  // Protect inline code first.
  const codes: string[] = [];
  let out = text.replace(/`([^`\n]+)`/g, (_, c: string) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\uE000${codes.length - 1}\uE001`;
  });
  out = escapeHtml(out);
  // Links [text](url) — only http(s)/tg links, keep others as text.
  out = out.replace(
    /\[([^\]\n]+)\]\(((?:https?:\/\/|tg:\/\/)[^)\s]+)\)/g,
    (_, t: string, u: string) => {
      return `<a href="${u.replace(/"/g, '&quot;')}">${t}</a>`;
    },
  );
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/__([^_\n]+?)__/g, '<b>$1</b>');
  out = out.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
  // Italic: *x* or _x_ when not glued to word characters (avoids snake_case and file_names).
  out = out.replace(/(^|[\s(])\*([^*\n]+?)\*(?=$|[\s.,;:!?)])/g, '$1<i>$2</i>');
  out = out.replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s.,;:!?)])/g, '$1<i>$2</i>');
  out = out.replace(/\uE000(\d+)\uE001/g, (_, i: string) => codes[Number(i)]!);
  return out;
}

/** Convert a markdown-ish answer to Telegram HTML. */
export function markdownToTelegramHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*```(\w+)?\s*$/.exec(line);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) buf.push(lines[i++]!);
      i++; // closing fence (or EOF)
      const cls = lang ? ` class="language-${lang}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // Markdown table → monospace block (Telegram has no tables).
      const buf: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const row = lines[i++]!.trim();
        if (/^\|[\s:|-]+\|$/.test(row)) continue; // separator row
        buf.push(
          row
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim())
            .join(' │ '),
        );
      }
      out.push(`<pre>${escapeHtml(buf.join('\n'))}</pre>`);
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push(`<b>${inline(heading[1]!.trim())}</b>`);
      i++;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('———');
      i++;
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        buf.push(inline(lines[i++]!.replace(/^\s*>\s?/, '')));
      }
      out.push(`<blockquote>${buf.join('\n')}</blockquote>`);
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(`${bullet[1]}• ${inline(bullet[2]!)}`);
      i++;
      continue;
    }
    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      out.push(`${numbered[1]}${numbered[2]}. ${inline(numbered[3]!)}`);
      i++;
      continue;
    }
    out.push(inline(line));
    i++;
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strip our HTML back to text (fallback when Telegram rejects the markup). */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/?(?:b|i|s|u|code|pre|a|blockquote)(?:\s[^>]*)?>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** Split HTML into ≤ `max` char messages at paragraph/line boundaries, keeping block tags balanced. */
export function chunkHtml(html: string, max = TELEGRAM_MAX_CHARS): string[] {
  if (html.length <= max) return [html];
  const chunks: string[] = [];
  let rest = html;
  while (rest.length > max) {
    // Prefer a blank line, then a newline, then a space, then a hard cut.
    let cut = rest.lastIndexOf('\n\n', max - 1);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max - 1);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max - 1);
    if (cut < max * 0.3) cut = max - 1;
    let head = rest.slice(0, cut);
    let tail = rest.slice(cut).replace(/^\n+/, '');
    // Re-balance <pre>/<code>/<blockquote> that were cut open.
    const open = openTags(head);
    if (open.length) {
      head += open
        .toReversed()
        .map((t) => `</${t}>`)
        .join('');
      tail = open.map((t) => (t === 'pre' ? '<pre>' : `<${t}>`)).join('') + tail;
    }
    chunks.push(head);
    rest = tail;
  }
  if (rest.trim()) chunks.push(rest);
  return chunks;
}

function openTags(html: string): string[] {
  const stack: string[] = [];
  const re = /<\/?(pre|code|blockquote|b|i|s|a)(?:\s[^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[0].startsWith('</');
    const tag = m[1]!;
    if (closing) {
      const idx = stack.lastIndexOf(tag);
      if (idx >= 0) stack.splice(idx, 1);
    } else stack.push(tag);
  }
  // Links cannot be reopened without their href; drop them from the reopen list.
  return stack.filter((t) => t !== 'a');
}
