import fs from 'node:fs';
import { parseDocument, parse as parseYaml, isMap, isScalar, isSeq } from 'yaml';
import { ConfigSchema } from './schema.js';
import { ConfigError } from './load.js';

/** Parse a CLI value: JSON/YAML scalars & arrays, falling back to the raw string. */
export function coerceValue(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return '';
  try {
    const v: unknown = parseYaml(s);
    // Keep things like `groq:llama` (which YAML would parse as a map) as plain strings.
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return s;
    return v;
  } catch {
    return s;
  }
}

export function getConfigValue(obj: unknown, dotPath: string): unknown {
  return dotPath
    .split('.')
    .filter(Boolean)
    .reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined,
      obj,
    );
}

/**
 * Set `dotPath` to `value` in config.yaml while preserving comments and layout.
 * Validates the resulting document against the schema before writing.
 */
export function setConfigValue(file: string, dotPath: string, value: unknown): { yaml: string } {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const doc = parseDocument(text);
  if (doc.errors.length)
    throw new ConfigError(`Invalid YAML in ${file}: ${doc.errors[0]!.message}`, file, [
      doc.errors[0]!.message,
    ]);
  const path = dotPath.split('.').filter(Boolean);
  if (path.length === 0) throw new ConfigError('empty key', file, ['empty key']);
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  if (value === undefined || value === null) doc.deleteIn(path);
  else {
    const existing = doc.getIn(path, true);
    if (isScalar(existing) && (typeof value !== 'object' || value === null)) {
      existing.value = value; // keeps the inline comment attached to the old value
    } else {
      const node = doc.createNode(value);
      // Short lists read better inline: fallbacks: [a, b]
      if (isSeq(node) && node.items.length <= 4) node.flow = true;
      doc.setIn(path, node);
    }
  }
  const json: unknown = doc.toJS() ?? {};
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(
      `Invalid config value for ${dotPath}: ${issues.join('; ')}`,
      file,
      issues,
    );
  }
  const out = doc.toString();
  fs.writeFileSync(file, out, { encoding: 'utf8', mode: 0o600 });
  return { yaml: out };
}

/** Insert or replace `KEY=value` in a dotenv file (created 0600 if missing). */
export function upsertEnvVar(file: string, key: string, value: string | undefined): void {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = text.split(/\r?\n/);
  const re = new RegExp(`^\\s*(export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  const needsQuotes = value !== undefined && /[\s#"'$]/.test(value);
  const rendered =
    value === undefined ? undefined : `${key}=${needsQuotes ? JSON.stringify(value) : value}`;
  let replaced = false;
  const out: string[] = [];
  for (const line of lines) {
    if (re.test(line)) {
      if (!replaced && rendered !== undefined) out.push(rendered);
      replaced = true;
      continue;
    }
    out.push(line);
  }
  if (!replaced && rendered !== undefined) {
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push(rendered);
  }
  let result = out.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  fs.writeFileSync(file, result, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* windows */
  }
}

export function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}
