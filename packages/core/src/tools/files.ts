import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { commandExists } from '../platform.js';
import {
  isProtectedPath,
  looksBinary,
  outsideWorkspace,
  resolveToolPath,
  statSafe,
} from './paths.js';
import { defineTool, type Tool, type ToolContext, type ToolRiskDetail } from './types.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  '.next',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'target',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function classifyRead(args: { path?: string }, ctx: ToolContext): ToolRiskDetail {
  const abs = resolveToolPath(ctx, args.path);
  const forbidden = isProtectedPath(ctx, abs);
  return { risk: 'read', outsideWorkspace: outsideWorkspace(ctx, abs), forbidden };
}
function classifyWrite(args: { path: string }, ctx: ToolContext): ToolRiskDetail {
  const abs = resolveToolPath(ctx, args.path);
  return {
    risk: 'write',
    outsideWorkspace: outsideWorkspace(ctx, abs),
    forbidden: isProtectedPath(ctx, abs),
  };
}

export const readFile = defineTool({
  name: 'read_file',
  toolset: 'files',
  risk: 'read',
  description:
    'Read a UTF-8 text file. Returns the content with line numbers. Use offset/limit for large files.',
  parameters: z.object({
    path: z.string().describe('File path (absolute, ~/…, or relative to the working directory)'),
    offset: z.number().int().min(1).optional().describe('First line to return (1-based)'),
    limit: z.number().int().min(1).max(5000).optional().describe('Maximum number of lines'),
  }),
  summarize: (a) => `read ${a.path}${a.offset ? ` from line ${a.offset}` : ''}`,
  classify: classifyRead,
  async execute(args, ctx) {
    const abs = resolveToolPath(ctx, args.path);
    const st = statSafe(abs);
    if (!st) return { content: `error: not found: ${abs}`, isError: true };
    if (st.isDirectory())
      return { content: `error: ${abs} is a directory — use list_dir`, isError: true };
    if (st.size > MAX_FILE_BYTES)
      return {
        content: `error: file too large (${st.size} bytes); read a range with offset/limit after inspecting with terminal (head/tail)`,
        isError: true,
      };
    const buf = fs.readFileSync(abs);
    if (looksBinary(buf))
      return { content: `error: ${abs} looks binary (${st.size} bytes)`, isError: true };
    const lines = buf.toString('utf8').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); // trailing newline is not a line
    const start = (args.offset ?? 1) - 1;
    const end = Math.min(lines.length, start + (args.limit ?? 2000));
    const width = String(end).length;
    const body = lines
      .slice(start, end)
      .map((l, i) => `${String(start + i + 1).padStart(width)}│${l}`)
      .join('\n');
    const more =
      end < lines.length ? `\n…(${lines.length - end} more lines; total ${lines.length})` : '';
    return { content: body + more, meta: { path: abs, lines: lines.length } };
  },
});

export const writeFile = defineTool({
  name: 'write_file',
  toolset: 'files',
  risk: 'write',
  description:
    'Create or overwrite a text file (parent folders are created). For small changes to an existing file prefer edit_file.',
  parameters: z.object({
    path: z.string().describe('File path'),
    content: z.string().describe('Full file content'),
    append: z.boolean().optional().describe('Append instead of overwrite'),
  }),
  summarize: (a) => `${a.append ? 'append to' : 'write'} ${a.path} (${a.content.length} chars)`,
  classify: classifyWrite,
  async execute(args, ctx) {
    const abs = resolveToolPath(ctx, args.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const existed = fs.existsSync(abs);
    if (args.append) fs.appendFileSync(abs, args.content, 'utf8');
    else fs.writeFileSync(abs, args.content, 'utf8');
    const lines = args.content.split('\n').length;
    return {
      content: `${existed ? (args.append ? 'appended to' : 'overwrote') : 'created'} ${abs} (${lines} lines, ${Buffer.byteLength(args.content)} bytes)`,
      meta: { path: abs },
    };
  },
});

export const editFile = defineTool({
  name: 'edit_file',
  toolset: 'files',
  risk: 'write',
  description:
    'Replace an exact text snippet inside a file. old_text must match exactly once (include enough surrounding lines to be unique) unless replace_all is true.',
  parameters: z.object({
    path: z.string().describe('File path'),
    old_text: z.string().min(1).describe('Exact text to find'),
    new_text: z.string().describe('Replacement text (empty string deletes)'),
    replace_all: z.boolean().optional().describe('Replace every occurrence'),
  }),
  summarize: (a) => `edit ${a.path} (${a.old_text.length}→${a.new_text.length} chars)`,
  classify: classifyWrite,
  async execute(args, ctx) {
    const abs = resolveToolPath(ctx, args.path);
    const st = statSafe(abs);
    if (!st?.isFile()) return { content: `error: not a file: ${abs}`, isError: true };
    const text = fs.readFileSync(abs, 'utf8');
    const count = text.split(args.old_text).length - 1;
    if (count === 0)
      return {
        content: 'error: old_text not found in file (match must be exact, including whitespace)',
        isError: true,
      };
    if (count > 1 && !args.replace_all)
      return {
        content: `error: old_text matches ${count} times — include more context or set replace_all`,
        isError: true,
      };
    const updated = args.replace_all
      ? text.split(args.old_text).join(args.new_text)
      : text.replace(args.old_text, () => args.new_text);
    fs.writeFileSync(abs, updated, 'utf8');
    return {
      content: `edited ${abs}: ${count} replacement${count === 1 ? '' : 's'}`,
      meta: { path: abs },
    };
  },
});

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

export const listDir = defineTool({
  name: 'list_dir',
  toolset: 'files',
  risk: 'read',
  description:
    'List files and folders (tree view). Hidden and vendor folders (node_modules, .git) are skipped by default.',
  parameters: z.object({
    path: z.string().optional().describe('Directory (default: working directory)'),
    depth: z.number().int().min(1).max(5).optional().describe('Recursion depth (default 2)'),
    hidden: z.boolean().optional().describe('Include dot-files'),
  }),
  summarize: (a) => `list ${a.path ?? '.'}`,
  classify: classifyRead,
  async execute(args, ctx) {
    const root = resolveToolPath(ctx, args.path);
    const st = statSafe(root);
    if (!st) return { content: `error: not found: ${root}`, isError: true };
    if (!st.isDirectory()) return { content: `${root} is a file (${formatSize(st.size)})` };
    const lines: string[] = [`${root}/`];
    let count = 0;
    const limit = 400;
    const walk = (dir: string, depth: number, prefix: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        lines.push(`${prefix}(unreadable: ${(e as Error).message})`);
        return;
      }
      entries = entries
        .filter((e) => args.hidden || !e.name.startsWith('.'))
        .toSorted(
          (a, b) =>
            Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
        );
      for (const e of entries) {
        if (count++ >= limit) {
          lines.push(`${prefix}… (listing capped at ${limit} entries)`);
          return;
        }
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          lines.push(`${prefix}${e.name}/`);
          if (depth > 1 && !SKIP_DIRS.has(e.name)) walk(full, depth - 1, `${prefix}  `);
        } else {
          const s = statSafe(full);
          lines.push(`${prefix}${e.name}${s ? ` (${formatSize(s.size)})` : ''}`);
        }
      }
    };
    walk(root, args.depth ?? 2, '  ');
    if (lines.length === 1) {
      let hiddenCount = 0;
      try {
        hiddenCount = fs.readdirSync(root).filter((n) => n.startsWith('.')).length;
      } catch {
        /* ignore */
      }
      lines.push(
        hiddenCount && !args.hidden
          ? `  (no visible files — ${hiddenCount} hidden dot-entries; pass hidden:true to list them)`
          : '  (empty directory)',
      );
    } else {
      lines.push(`(${count} entries)`);
    }
    return { content: lines.join('\n') };
  },
});

export const searchFiles = defineTool({
  name: 'search_files',
  toolset: 'files',
  risk: 'read',
  description:
    'Search file contents for a pattern (ripgrep when available). Returns file:line: text matches.',
  parameters: z.object({
    pattern: z.string().min(1).describe('Text or regular expression to search for'),
    path: z
      .string()
      .optional()
      .describe('Directory or file to search (default: working directory)'),
    glob: z.string().optional().describe('Only files matching this glob, e.g. *.ts'),
    regex: z
      .boolean()
      .optional()
      .describe('Treat pattern as a regular expression (default: literal)'),
    case_sensitive: z.boolean().optional(),
    max_results: z.number().int().min(1).max(500).optional().describe('Default 100'),
  }),
  summarize: (a) => `search "${a.pattern}" in ${a.path ?? '.'}`,
  classify: classifyRead,
  async execute(args, ctx) {
    const root = resolveToolPath(ctx, args.path);
    if (!statSafe(root)) return { content: `error: not found: ${root}`, isError: true };
    const max = args.max_results ?? 100;
    const rg = commandExists('rg', ctx.env);
    if (rg) {
      const rgArgs = [
        '--line-number',
        '--no-heading',
        '--color',
        'never',
        '--max-count',
        '50',
        '-m',
        '50',
      ];
      if (!args.regex) rgArgs.push('--fixed-strings');
      if (!args.case_sensitive) rgArgs.push('--ignore-case');
      if (args.glob) rgArgs.push('--glob', args.glob);
      rgArgs.push('--', args.pattern, root);
      const r = spawnSync(rg, rgArgs, {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
      });
      if (r.status === 0 || r.status === 1) {
        const lines = r.stdout
          .split('\n')
          .filter(Boolean)
          .slice(0, max)
          .map((l) => l.replace(root + path.sep, '').replace(/^([^:]+:\d+):/, '$1: '));
        return { content: lines.length ? lines.join('\n') : 'no matches' };
      }
    }
    const re = args.regex
      ? new RegExp(args.pattern, args.case_sensitive ? '' : 'i')
      : new RegExp(
          args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          args.case_sensitive ? '' : 'i',
        );
    const globRe = args.glob
      ? new RegExp(
          '^' +
            args.glob
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*\*/g, '.*')
              .replace(/\*/g, '[^/]*')
              .replace(/\?/g, '.') +
            '$',
        )
      : undefined;
    const out: string[] = [];
    const visit = (p: string) => {
      if (out.length >= max) return;
      const st = statSafe(p);
      if (!st) return;
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(path.basename(p))) return;
        for (const e of fs.readdirSync(p)) {
          if (e.startsWith('.')) continue;
          visit(path.join(p, e));
        }
        return;
      }
      if (st.size > MAX_FILE_BYTES) return;
      if (globRe && !globRe.test(path.basename(p))) return;
      const buf = fs.readFileSync(p);
      if (looksBinary(buf)) return;
      const rel = path.relative(root, p) || path.basename(p);
      buf
        .toString('utf8')
        .split('\n')
        .forEach((line, i) => {
          if (out.length < max && re.test(line))
            out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 300)}`);
        });
    };
    visit(root);
    return { content: out.length ? out.join('\n') : 'no matches' };
  },
});

export const FILE_TOOLS: Tool[] = [
  readFile as Tool,
  writeFile as Tool,
  editFile as Tool,
  listDir as Tool,
  searchFiles as Tool,
];
