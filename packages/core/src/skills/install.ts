import fs from 'node:fs';
import path from 'node:path';
import {
  isValidSkillName,
  parseFrontmatter,
  SKILL_FILE,
  SkillError,
  type Skill,
  type SkillStore,
} from './index.js';

/**
 * Install skills from GitHub (`sindar skills install github:owner/repo[/path][@ref]`).
 * Files are fetched through api.github.com (works even where raw.githubusercontent.com
 * is blocked), scanned for dangerous content, and written WITHOUT execute permission —
 * SINDAR never runs scripts from a skill automatically; the agent runs them through the
 * terminal tool, under the normal approval rules.
 */

export interface SkillSpec {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}

export interface SkillBundle {
  /** Directory name the skill will be installed as. */
  name: string;
  /** All files, paths relative to the skill dir (SKILL.md first). */
  files: Array<{ path: string; content: string }>;
  origin: string;
}

export interface ScanWarning {
  level: 'danger' | 'warn';
  file: string;
  line: number;
  pattern: string;
  text: string;
}

export function parseSkillSpec(input: string): SkillSpec {
  let s = input.trim();
  const url =
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/.exec(
      s,
    );
  if (url) {
    return {
      owner: url[1]!,
      repo: url[2]!,
      ref: url[3],
      path: (url[4] ?? '').replace(/\/+$/, ''),
    };
  }
  s = s.replace(/^github:/, '').replace(/^gh:/, '');
  let ref: string | undefined;
  const at = s.indexOf('@');
  if (at > 0) {
    ref = s.slice(at + 1);
    s = s.slice(0, at);
  }
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new SkillError(
      `cannot parse "${input}" — expected github:owner/repo[/path][@ref]`,
      'invalid',
    );
  }
  return { owner: parts[0]!, repo: parts[1]!, path: parts.slice(2).join('/'), ref };
}

export function specToString(spec: SkillSpec): string {
  return `github:${spec.owner}/${spec.repo}${spec.path ? `/${spec.path}` : ''}${spec.ref ? `@${spec.ref}` : ''}`;
}

interface GhEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size: number;
}

export interface FetchOptions {
  fetch?: typeof fetch;
  token?: string;
  /** Max files per skill (default 40) and per-file bytes (default 512 KB). */
  maxFiles?: number;
  maxFileBytes?: number;
  signal?: AbortSignal;
}

const SKILL_SUBDIRS = new Set(['scripts', 'references', 'assets', 'templates']);

export async function fetchGitHubSkills(
  spec: SkillSpec,
  opts: FetchOptions = {},
): Promise<SkillBundle[]> {
  const f = opts.fetch ?? fetch;
  const maxFiles = opts.maxFiles ?? 40;
  const maxFileBytes = opts.maxFileBytes ?? 512 * 1024;
  const headers: Record<string, string> = {
    'user-agent': 'sindar-skills',
    accept: 'application/vnd.github+json',
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const base = `https://api.github.com/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}/contents`;
  const q = spec.ref ? `?ref=${encodeURIComponent(spec.ref)}` : '';

  const listDir = async (p: string): Promise<GhEntry[]> => {
    const res = await f(`${base}/${p}${q}`, { headers, signal: opts.signal });
    if (res.status === 404) throw new SkillError(`not found on GitHub: ${p || '/'}`, 'not-found');
    if (!res.ok) throw new SkillError(`GitHub API error ${res.status} for ${p || '/'}`, 'invalid');
    const json = (await res.json()) as GhEntry | GhEntry[];
    return Array.isArray(json) ? json : [json];
  };
  const readFile = async (p: string): Promise<string> => {
    const res = await f(`${base}/${p}${q}`, {
      headers: { ...headers, accept: 'application/vnd.github.raw+json' },
      signal: opts.signal,
    });
    if (!res.ok) throw new SkillError(`GitHub API error ${res.status} for ${p}`, 'invalid');
    return res.text();
  };

  const bundleFrom = async (dirPath: string, entries: GhEntry[]): Promise<SkillBundle> => {
    const files: Array<{ path: string; content: string }> = [];
    const skillFile = entries.find((e) => e.type === 'file' && e.name === SKILL_FILE);
    if (!skillFile) throw new SkillError(`${dirPath || '/'} has no ${SKILL_FILE}`, 'invalid');
    files.push({ path: SKILL_FILE, content: await readFile(skillFile.path) });
    for (const e of entries) {
      if (e.type === 'dir' && SKILL_SUBDIRS.has(e.name)) {
        const sub = await listDir(e.path);
        for (const se of sub) {
          if (files.length >= maxFiles) break;
          if (se.type !== 'file' || se.size > maxFileBytes) continue;
          files.push({ path: `${e.name}/${se.name}`, content: await readFile(se.path) });
        }
      } else if (
        e.type === 'file' &&
        e.name !== SKILL_FILE &&
        /\.(md|txt|json|ya?ml)$/i.test(e.name)
      ) {
        if (files.length >= maxFiles || e.size > maxFileBytes) continue;
        files.push({ path: e.name, content: await readFile(e.path) });
      }
    }
    const fm = parseFrontmatter(files[0]!.content);
    const name =
      typeof fm.data.name === 'string' && fm.data.name
        ? fm.data.name
        : path.posix.basename(dirPath) || spec.repo;
    return { name, files, origin: specToString({ ...spec, path: dirPath }) };
  };

  const root = await listDir(spec.path);
  if (root.some((e) => e.type === 'file' && e.name === SKILL_FILE)) {
    return [await bundleFrom(spec.path, root)];
  }
  // A folder of skills (or a repo with skills/): install every sub-dir that has a SKILL.md.
  const candidates = root.filter((e) => e.type === 'dir' && !e.name.startsWith('.'));
  const skillsDir = candidates.find((e) => e.name === 'skills');
  const dirs = skillsDir && spec.path === '' ? await listDir(skillsDir.path) : candidates;
  const bundles: SkillBundle[] = [];
  for (const d of dirs.filter((e) => e.type === 'dir').slice(0, 20)) {
    const entries = await listDir(d.path);
    if (!entries.some((e) => e.type === 'file' && e.name === SKILL_FILE)) continue;
    bundles.push(await bundleFrom(d.path, entries));
  }
  if (!bundles.length) {
    throw new SkillError(`no ${SKILL_FILE} found under ${specToString(spec)}`, 'not-found');
  }
  return bundles;
}

/* ---------- security scan ---------- */

const DANGER: Array<[RegExp, string]> = [
  [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i, 'pipes a download into a shell'],
  [/\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME|\.\.)(\s|$)/i, 'recursive delete of home or root'],
  [/\bbase64\s+(-d|--decode)\b[^\n]*\|\s*(ba|z)?sh\b/i, 'decodes and runs hidden code'],
  [/\b(nc|ncat|netcat)\b[^\n]*\s-e\b|\/dev\/tcp\//i, 'reverse shell'],
  [
    /(\.ssh\/|id_rsa|id_ed25519|gateway\.token|\.sindar\/\.env)/i,
    'touches SSH keys or SINDAR secrets',
  ],
  [
    /\b(termux-sms-send|termux-telephony-call|termux-contact-list|termux-sms-list)\b/i,
    'accesses SMS/calls/contacts',
  ],
  [
    /ignore (all |the |any )?(previous|prior|above) (instructions|rules)/i,
    'prompt-injection phrasing',
  ],
  [/\b(do not|don't|never) (tell|inform|show) the user\b/i, 'asks to hide actions from the user'],
];
const WARN: Array<[RegExp, string]> = [
  [/\bsudo\b/, 'uses sudo'],
  [/\bchmod\s+(\+x|7[0-7]{2})\b/, 'makes files executable'],
  [/\beval\b/, 'uses eval'],
  [
    /\b(curl|wget|fetch|requests\.(post|put))\b[^\n]*(-d|--data|--upload-file|-T)\b/i,
    'uploads data to the network',
  ],
  [/\b(ngrok|webhook\.site|requestbin|pastebin\.com)\b/i, 'mentions an exfiltration-style service'],
  [/\bcrontab\b|\bsystemctl\b|\btermux-job-scheduler\b/i, 'schedules background jobs'],
  [
    /(^|[^.\w])\.env\b|api[_-]?key|secret[_-]?key|access[_-]?token|\.netrc|credentials\.json/i,
    'touches credentials',
  ],
];

export function scanSkillFiles(files: Array<{ path: string; content: string }>): ScanWarning[] {
  const out: ScanWarning[] = [];
  for (const f of files) {
    const lines = f.content.split('\n');
    lines.forEach((text, i) => {
      for (const [re, pattern] of DANGER) {
        if (re.test(text))
          out.push({
            level: 'danger',
            file: f.path,
            line: i + 1,
            pattern,
            text: text.trim().slice(0, 160),
          });
      }
      for (const [re, pattern] of WARN) {
        if (re.test(text))
          out.push({
            level: 'warn',
            file: f.path,
            line: i + 1,
            pattern,
            text: text.trim().slice(0, 160),
          });
      }
    });
  }
  return out;
}

/* ---------- write ---------- */

export interface InstallResult {
  skill: Skill;
  warnings: ScanWarning[];
}

/**
 * Write a fetched bundle into the user skills dir. Refuses `danger` findings unless
 * `force`. Files are written 0o644 (never executable).
 */
export function installBundle(
  store: SkillStore,
  bundle: SkillBundle,
  opts: { force?: boolean; overwrite?: boolean } = {},
): InstallResult {
  const warnings = scanSkillFiles(bundle.files);
  if (!opts.force && warnings.some((w) => w.level === 'danger')) {
    const first = warnings.find((w) => w.level === 'danger')!;
    throw new SkillError(
      `refusing to install "${bundle.name}": ${first.pattern} (${first.file}:${first.line}). Re-run with --yes to override.`,
      'invalid',
    );
  }
  if (!isValidSkillName(bundle.name)) {
    throw new SkillError(`invalid skill name "${bundle.name}"`, 'invalid-name');
  }
  const skillMd = bundle.files.find((f) => f.path === SKILL_FILE)!;
  const fm = parseFrontmatter(skillMd.content);
  const description =
    typeof fm.data.description === 'string' ? fm.data.description : (fm.body.split('\n')[0] ?? '');
  const dir = store.dirFor(bundle.name);
  if (fs.existsSync(dir) && !opts.overwrite) {
    throw new SkillError(
      `skill "${bundle.name}" already exists — remove it first or pass overwrite`,
      'exists',
    );
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // SKILL.md is written verbatim (keeps the author's frontmatter), extras under their paths.
  for (const f of bundle.files) {
    const rel = path.normalize(f.path);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, { encoding: 'utf8', mode: 0o644 });
  }
  fs.writeFileSync(
    path.join(dir, '.origin.json'),
    JSON.stringify({ origin: bundle.origin, installedAt: Date.now(), description }, null, 2),
    'utf8',
  );
  const skill = store.get(bundle.name);
  if (!skill) throw new SkillError(`install of "${bundle.name}" failed`, 'invalid');
  return { skill, warnings };
}
