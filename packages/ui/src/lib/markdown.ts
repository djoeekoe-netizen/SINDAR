import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'PRE' || node.tagName === 'CODE' || node.tagName === 'TABLE') {
    node.setAttribute('dir', 'ltr');
  }
});

const cache = new Map<string, string>();

/** Markdown → sanitized HTML (cached by input; streaming text re-renders cheaply enough). */
export function renderMarkdown(src: string): string {
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  const html = DOMPurify.sanitize(marked.parse(src, { async: false }) as string, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input'],
  });
  if (cache.size > 300) cache.clear();
  cache.set(src, html);
  return html;
}
