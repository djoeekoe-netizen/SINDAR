import fs from 'node:fs';
import path from 'node:path';

/**
 * Skills = reusable procedures stored as `~/.sindar/skills/<name>/SKILL.md`
 * (agentskills.io-compatible: YAML frontmatter `name` + `description`, markdown body),
 * optionally with `scripts/`, `references/` and `assets/` next to it.
 * Progressive loading: only name + description go into the system prompt; the body is
 * read on demand with the `skill` tool.
 */
export type SkillSource = 'bundled' | 'user' | 'installed' | 'extra';

export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  tags: string[];
  source: SkillSource;
  dir: string;
  file: string;
  chars: number;
  updatedAt: number;
  /** Where an installed skill came from (github:owner/repo/path). */
  origin?: string;
}

export interface Skill extends SkillMeta {
  body: string;
  raw: string;
  /** Extra files relative to the skill dir (scripts/…, references/…). */
  files: string[];
}

export interface SkillInput {
  name: string;
  description: string;
  body: string;
  tags?: string[];
  version?: string;
}

export const SKILL_FILE = 'SKILL.md';
const MARKER_BUNDLED = '.bundled';
const MARKER_ORIGIN = '.origin.json';
export const MAX_SKILL_CHARS = 20_000;
export const SKILL_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

export class SkillError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid-name' | 'not-found' | 'exists' | 'too-large' | 'invalid',
  ) {
    super(message);
    this.name = 'SkillError';
  }
}

/* ---------- frontmatter ---------- */

export interface Frontmatter {
  data: Record<string, string | string[]>;
  body: string;
}

export function parseFrontmatter(raw: string): Frontmatter {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  let listKey: string | undefined;
  for (const line of m[1]!.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]!));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = kv[2]!.trim();
    if (value === '') {
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = undefined;
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body: text.slice(m[0].length).replace(/^\n+/, '') };
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1);
  return t;
}

function yamlString(v: string): string {
  return /[:#"'\n[\]{}&*!|>%@`,]/.test(v) || v !== v.trim() ? JSON.stringify(v) : v;
}

export function serializeSkill(input: SkillInput): string {
  const lines = [
    '---',
    `name: ${yamlString(input.name)}`,
    `description: ${yamlString(input.description.replace(/\s+/g, ' ').trim())}`,
    `version: ${yamlString(input.version ?? '1.0.0')}`,
  ];
  if (input.tags?.length) lines.push(`tags: [${input.tags.map(yamlString).join(', ')}]`);
  lines.push('---', '', input.body.trim(), '');
  return lines.join('\n');
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name) && !name.startsWith('.');
}

/* ---------- store ---------- */

export interface SkillStoreOptions {
  /** `~/.sindar/skills` — writable; where created/installed skills live. */
  user: string;
  /** Read-only extra directories (config `skills.extraDirs`). */
  extra?: string[];
}

export class SkillStore {
  readonly userDir: string;
  readonly extraDirs: string[];

  constructor(opts: SkillStoreOptions) {
    this.userDir = opts.user;
    this.extraDirs = opts.extra ?? [];
  }

  /** All skills, user dir first (wins on name clashes), sorted by name. */
  list(): SkillMeta[] {
    const seen = new Map<string, SkillMeta>();
    const dirs: Array<[string, SkillSource]> = [
      [this.userDir, 'user'],
      ...this.extraDirs.map((d): [string, SkillSource] => [d, 'extra']),
    ];
    for (const [root, source] of dirs) {
      for (const meta of scanDir(root, source)) {
        if (!seen.has(meta.name)) seen.set(meta.name, meta);
      }
    }
    return Array.from(seen.values()).toSorted((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): Skill | undefined {
    const meta = this.list().find((s) => s.name === name);
    if (!meta) return undefined;
    const raw = fs.readFileSync(meta.file, 'utf8');
    const { body } = parseFrontmatter(raw);
    return { ...meta, raw, body, files: listExtraFiles(meta.dir) };
  }

  dirFor(name: string): string {
    return path.join(this.userDir, name);
  }

  create(input: SkillInput, opts: { overwrite?: boolean; origin?: string } = {}): Skill {
    if (!isValidSkillName(input.name)) {
      throw new SkillError(
        `invalid skill name "${input.name}" — use letters, digits, - and _ (no spaces or slashes)`,
        'invalid-name',
      );
    }
    if (!input.description.trim() || !input.body.trim()) {
      throw new SkillError('description and body are required', 'invalid');
    }
    const dir = this.dirFor(input.name);
    const file = path.join(dir, SKILL_FILE);
    if (fs.existsSync(file) && !opts.overwrite) {
      throw new SkillError(`skill "${input.name}" already exists — use update`, 'exists');
    }
    const raw = serializeSkill(input);
    if (raw.length > MAX_SKILL_CHARS) {
      throw new SkillError(`skill is ${raw.length} chars; max is ${MAX_SKILL_CHARS}`, 'too-large');
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, raw, 'utf8');
    if (opts.origin) {
      fs.writeFileSync(
        path.join(dir, MARKER_ORIGIN),
        JSON.stringify({ origin: opts.origin, installedAt: Date.now() }, null, 2),
        'utf8',
      );
    }
    return this.get(input.name)!;
  }

  /**
   * Patch an existing skill. Any of description/body/tags may change; a dated line is
   * appended to a `## Changelog` section when `changelog` is given. Version patch-bumps.
   */
  update(
    name: string,
    patch: { description?: string; body?: string; tags?: string[]; changelog?: string },
  ): Skill {
    const current = this.get(name);
    if (!current) throw new SkillError(`skill "${name}" not found`, 'not-found');
    if (current.source === 'extra') {
      throw new SkillError(`skill "${name}" lives in a read-only directory`, 'invalid');
    }
    let body = (patch.body ?? current.body).trim();
    if (patch.changelog) {
      const date = new Date().toISOString().slice(0, 10);
      const entry = `- ${date}: ${patch.changelog.replace(/\s+/g, ' ').trim()}`;
      body = /^## Changelog\s*$/m.test(body)
        ? body.replace(/^## Changelog\s*$/m, `## Changelog\n${entry}`)
        : `${body}\n\n## Changelog\n${entry}`;
    }
    const raw = serializeSkill({
      name,
      description: patch.description ?? current.description,
      tags: patch.tags ?? current.tags,
      version: bumpVersion(current.version),
      body,
    });
    if (raw.length > MAX_SKILL_CHARS) {
      throw new SkillError(`skill is ${raw.length} chars; max is ${MAX_SKILL_CHARS}`, 'too-large');
    }
    fs.writeFileSync(current.file, raw, 'utf8');
    // A user edit of a bundled skill makes it theirs (no longer refreshed by updates).
    const marker = path.join(current.dir, MARKER_BUNDLED);
    if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });
    return this.get(name)!;
  }

  remove(name: string): void {
    const meta = this.list().find((s) => s.name === name);
    if (!meta) throw new SkillError(`skill "${name}" not found`, 'not-found');
    if (meta.source === 'extra') {
      throw new SkillError(`skill "${name}" lives in a read-only directory`, 'invalid');
    }
    fs.rmSync(meta.dir, { recursive: true, force: true });
  }

  /**
   * Compact index for the system prompt: `- name — description`, capped so the prompt
   * stays small on free-tier token budgets.
   */
  index(maxChars = 1800): { text: string; total: number; shown: number } {
    const all = this.list();
    const lines: string[] = [];
    let used = 0;
    for (const s of all) {
      const line = `- ${s.name} — ${s.description.slice(0, 140)}`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return { text: lines.join('\n'), total: all.length, shown: lines.length };
  }

  /** Mark a directory as bundled (shipped with SINDAR). */
  static markBundled(dir: string): void {
    fs.writeFileSync(path.join(dir, MARKER_BUNDLED), '', 'utf8');
  }
}

function scanDir(root: string, source: SkillSource): SkillMeta[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SkillMeta[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(root, e.name);
    const file = path.join(dir, SKILL_FILE);
    let raw: string;
    let st: fs.Stats;
    try {
      raw = fs.readFileSync(file, 'utf8');
      st = fs.statSync(file);
    } catch {
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    const name = typeof data.name === 'string' && data.name ? data.name : e.name;
    const description =
      typeof data.description === 'string' && data.description
        ? data.description
        : firstParagraph(body);
    let src: SkillSource = source;
    let origin: string | undefined;
    if (source === 'user') {
      if (fs.existsSync(path.join(dir, MARKER_BUNDLED))) src = 'bundled';
      else if (fs.existsSync(path.join(dir, MARKER_ORIGIN))) {
        src = 'installed';
        try {
          origin = (
            JSON.parse(fs.readFileSync(path.join(dir, MARKER_ORIGIN), 'utf8')) as {
              origin?: string;
            }
          ).origin;
        } catch {
          /* ignore */
        }
      }
    }
    out.push({
      name,
      description: description.replace(/\s+/g, ' ').trim(),
      version: typeof data.version === 'string' ? data.version : '1.0.0',
      tags: Array.isArray(data.tags)
        ? data.tags
        : typeof data.tags === 'string'
          ? data.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      source: src,
      dir,
      file,
      chars: raw.length,
      updatedAt: st.mtimeMs,
      origin,
    });
  }
  return out;
}

function listExtraFiles(dir: string, max = 40): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string, depth: number) => {
    if (depth > 3 || out.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === SKILL_FILE) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r, depth + 1);
      else out.push(r);
      if (out.length >= max) return;
    }
  };
  walk(dir, '', 0);
  return out.toSorted();
}

function firstParagraph(body: string): string {
  const para = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s*/, '').trim())
    .find((p) => p && !p.startsWith('---'));
  return (para ?? '').slice(0, 200);
}

function bumpVersion(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return '1.0.1';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}
