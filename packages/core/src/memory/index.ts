import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { SindarPaths } from '../paths.js';

/**
 * Persistent memory = two markdown files the model can edit atomically:
 *   MEMORY.md  — facts, decisions, project state (target `memory`)
 *   USER.md    — who the user is and how they like to work (target `user`)
 * Each entry is one `- ` bullet line; entries get a short stable id derived
 * from their text so the model can replace/remove them without line numbers.
 */
export type MemoryTarget = 'memory' | 'user';

export interface MemoryEntry {
  id: string;
  text: string;
  /** Closest `## heading` above the entry, if any. */
  section?: string;
  /** 0-based line index in the file. */
  line: number;
}

export interface MemoryLimits {
  memory: number;
  user: number;
}

export const DEFAULT_MEMORY_LIMITS: MemoryLimits = { memory: 12_000, user: 6_000 };

export function entryId(text: string): string {
  return createHash('sha1').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 6);
}

const BULLET = /^\s*[-*•]\s+(.*\S)\s*$/;
const HEADING = /^\s*#{2,6}\s+(.*\S)\s*$/;

export function parseEntries(content: string): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  let section: string | undefined;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = HEADING.exec(line);
    if (h) {
      section = h[1];
      continue;
    }
    const b = BULLET.exec(line);
    if (!b) continue;
    out.push({ id: entryId(b[1]!), text: b[1]!, section, line: i });
  }
  return out;
}

export class MemoryError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'too-large' | 'empty' | 'duplicate',
  ) {
    super(message);
    this.name = 'MemoryError';
  }
}

export class MemoryFiles {
  constructor(
    private readonly paths: Pick<SindarPaths, 'memory' | 'user'>,
    private readonly limits: MemoryLimits = DEFAULT_MEMORY_LIMITS,
  ) {}

  file(target: MemoryTarget): string {
    return target === 'memory' ? this.paths.memory : this.paths.user;
  }

  limit(target: MemoryTarget): number {
    return target === 'memory' ? this.limits.memory : this.limits.user;
  }

  read(target: MemoryTarget): string {
    try {
      return fs.readFileSync(this.file(target), 'utf8');
    } catch {
      return '';
    }
  }

  /** Overwrite the whole file (UI editor / CLI). Enforces the size cap. */
  write(target: MemoryTarget, content: string): void {
    if (content.length > this.limit(target)) {
      throw new MemoryError(
        `${target} file would be ${content.length} chars; limit is ${this.limit(target)}. Consolidate or remove entries first.`,
        'too-large',
      );
    }
    fs.writeFileSync(this.file(target), content, { encoding: 'utf8', mode: 0o600 });
  }

  list(target: MemoryTarget): MemoryEntry[] {
    return parseEntries(this.read(target));
  }

  /** Size status used by the system prompt and the UI. */
  stats(target: MemoryTarget): { chars: number; limit: number; entries: number } {
    const content = this.read(target);
    return {
      chars: content.length,
      limit: this.limit(target),
      entries: parseEntries(content).length,
    };
  }

  add(target: MemoryTarget, text: string, section?: string): MemoryEntry {
    const clean = normalize(text);
    if (!clean) throw new MemoryError('text is empty', 'empty');
    const content = this.read(target);
    const existing = parseEntries(content);
    const id = entryId(clean);
    if (existing.some((e) => e.id === id)) {
      throw new MemoryError(`an identical entry already exists (${id})`, 'duplicate');
    }
    const lines = content.length ? content.replace(/\n+$/, '').split('\n') : [];
    const bullet = `- ${clean}`;
    let insertAt = lines.length;
    if (section) {
      const head = section.trim();
      let headIdx = lines.findIndex((l) => {
        const h = HEADING.exec(l);
        return h && h[1]!.toLowerCase() === head.toLowerCase();
      });
      if (headIdx === -1) {
        lines.push('', `## ${head}`);
        headIdx = lines.length - 1;
      }
      // Insert after the last bullet/blank-free line of that section.
      insertAt = headIdx + 1;
      while (insertAt < lines.length && !HEADING.test(lines[insertAt]!)) insertAt++;
      while (insertAt > headIdx + 1 && lines[insertAt - 1]!.trim() === '') insertAt--;
    }
    lines.splice(insertAt, 0, bullet);
    const next = `${lines.join('\n')}\n`;
    this.write(target, next);
    return parseEntries(next).find((e) => e.id === id)!;
  }

  replace(target: MemoryTarget, id: string, text: string): MemoryEntry {
    const clean = normalize(text);
    if (!clean) throw new MemoryError('text is empty', 'empty');
    const content = this.read(target);
    const entry = parseEntries(content).find((e) => e.id === id);
    if (!entry) throw new MemoryError(`no entry with id ${id}`, 'not-found');
    const lines = content.split('\n');
    lines[entry.line] = `- ${clean}`;
    const next = lines.join('\n');
    this.write(target, next);
    return parseEntries(next).find((e) => e.line === entry.line)!;
  }

  remove(target: MemoryTarget, id: string): MemoryEntry {
    const content = this.read(target);
    const entry = parseEntries(content).find((e) => e.id === id);
    if (!entry) throw new MemoryError(`no entry with id ${id}`, 'not-found');
    const lines = content.split('\n');
    lines.splice(entry.line, 1);
    this.write(target, lines.join('\n'));
    return entry;
  }

  /** Compact listing for the model: `[id] text` grouped by section. */
  format(target: MemoryTarget): string {
    const entries = this.list(target);
    if (!entries.length) return '(empty)';
    const out: string[] = [];
    let section: string | undefined;
    for (const e of entries) {
      if (e.section !== section) {
        section = e.section;
        if (section) out.push(`## ${section}`);
      }
      out.push(`[${e.id}] ${e.text}`);
    }
    return out.join('\n');
  }
}

function normalize(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/^[-*•]\s+/, '')
    .trim();
}
