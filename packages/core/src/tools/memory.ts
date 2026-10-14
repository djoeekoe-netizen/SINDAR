import { z } from 'zod';
import { MemoryError, MemoryFiles } from '../memory/index.js';
import { defineTool, type ToolContext } from './types.js';

function memoryFor(ctx: ToolContext): MemoryFiles {
  return ctx.services?.memory ?? new MemoryFiles(ctx.paths);
}

export const memory = defineTool({
  name: 'memory',
  toolset: 'memory',
  risk: 'write',
  description: [
    'Long-term memory that survives across sessions. Two files: target "user" = who the user is and how they like to work',
    '(name, language, tone, projects, constraints); target "memory" = durable facts, decisions and project state.',
    'Save things the user would be annoyed to repeat ("I prefer short answers", "my project is X at ~/x").',
    'Do NOT save transient details, secrets, or anything already in the files. Keep entries to one short line each;',
    'when the user states several facts at once, save ALL of them (one per line in a single add).',
    'Actions: add (text, optional section) · replace (id, text) · remove (id) · list.',
  ].join(' '),
  parameters: z.object({
    action: z.enum(['add', 'replace', 'remove', 'list']),
    target: z.enum(['memory', 'user']).default('memory'),
    text: z
      .string()
      .max(600)
      .optional()
      .describe('Entry text (add/replace). For add, each non-empty line becomes its own entry'),
    id: z.string().optional().describe('Entry id from list (replace/remove)'),
    section: z
      .string()
      .max(60)
      .optional()
      .describe('Optional "## heading" to file the entry under'),
  }),
  summarize: (a) =>
    a.action === 'list'
      ? `memory list ${a.target}`
      : `memory ${a.action} ${a.target}${a.text ? `: ${a.text.slice(0, 60)}` : a.id ? ` ${a.id}` : ''}`,
  // Memory files live in ~/.sindar but are the model's own notebook — no approval needed.
  classify: () => ({ risk: 'write', outsideWorkspace: false }),
  async execute(args, ctx) {
    const mem = memoryFor(ctx);
    try {
      switch (args.action) {
        case 'list': {
          const st = mem.stats(args.target);
          return {
            content: `${args.target.toUpperCase()} (${st.entries} entries, ${st.chars}/${st.limit} chars)\n${mem.format(args.target)}`,
          };
        }
        case 'add': {
          const lines = (args.text ?? '')
            .split(/\r?\n/)
            .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim())
            .filter(Boolean);
          if (lines.length === 0)
            return { content: 'error: text is required for add', isError: true };
          const ids = lines.map((l) => mem.add(args.target, l, args.section).id);
          const st = mem.stats(args.target);
          return {
            content: `saved to ${args.target} as ${ids.map((id) => `[${id}]`).join(', ')} (${st.chars}/${st.limit} chars)`,
          };
        }
        case 'replace': {
          if (!args.id || !args.text)
            return { content: 'error: id and text are required for replace', isError: true };
          const e = mem.replace(args.target, args.id, args.text);
          return { content: `replaced [${args.id}] → [${e.id}] in ${args.target}` };
        }
        case 'remove': {
          if (!args.id) return { content: 'error: id is required for remove', isError: true };
          const e = mem.remove(args.target, args.id);
          return { content: `removed [${e.id}] from ${args.target}: ${e.text}` };
        }
      }
    } catch (err) {
      if (err instanceof MemoryError) {
        const hint =
          err.code === 'too-large'
            ? ' Use memory list, then remove or merge old entries, then add again.'
            : err.code === 'not-found'
              ? ' Use memory list to see current ids.'
              : '';
        return { content: `error: ${err.message}.${hint}`, isError: true };
      }
      throw err;
    }
    return { content: 'error: unknown action', isError: true };
  },
});

export const sessionSearch = defineTool({
  name: 'session_search',
  toolset: 'memory',
  risk: 'read',
  description: [
    'Search your past conversations with this user (full-text, any language). Use it when the user refers to',
    'something discussed before ("like we did yesterday", "that file you wrote", "what did I decide about X").',
    "Returns the best matching sessions with snippets; pass sessionId to read one session's transcript.",
  ].join(' '),
  parameters: z.object({
    query: z.string().max(200).optional().describe('Words to look for (2–8 words work best)'),
    sessionId: z.string().optional().describe('Read this session instead of searching'),
    limit: z.number().int().min(1).max(10).default(5),
    includeTools: z.boolean().default(false).describe('Also search tool outputs (noisier)'),
  }),
  summarize: (a) =>
    a.sessionId ? `read session ${a.sessionId.slice(0, 8)}` : `search sessions "${a.query ?? ''}"`,
  async execute(args, ctx) {
    const sessions = ctx.services?.sessions;
    if (!sessions)
      return { content: 'error: session search is not available in this context', isError: true };
    if (args.sessionId) {
      const s = sessions.find(args.sessionId);
      if (!s) return { content: `error: no session matching "${args.sessionId}"`, isError: true };
      const text = sessions.transcript(s.id, { maxChars: 7000, includeTools: args.includeTools });
      const head = `Session ${s.id} · ${s.title ?? '(untitled)'} · ${fmtDate(s.updatedAt)} · ${s.channel}`;
      return { content: `${head}\n\n${text || '(empty)'}` };
    }
    const q = (args.query ?? '').trim();
    if (!q) return { content: 'error: query or sessionId is required', isError: true };
    const results = sessions.search(q, {
      limit: args.limit,
      excludeSession: ctx.sessionId,
      roles: args.includeTools ? ['user', 'assistant', 'tool'] : undefined,
    });
    if (!results.length) return { content: `No past conversation matches "${q}".` };
    const lines = [
      `${results.length} session(s) match "${q}" (newest activity first within rank):`,
    ];
    results.forEach((r, i) => {
      const s = r.session;
      lines.push(
        `${i + 1}. [${s.id}] ${s.title ?? '(untitled)'} — ${fmtDate(s.updatedAt)} · ${s.channel} · ${s.messageCount} messages`,
      );
      for (const h of r.hits) lines.push(`   ${h.role}: ${h.snippet}`);
    });
    lines.push('', 'Read a full session with session_search({ sessionId }).');
    return { content: lines.join('\n') };
  },
});

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
