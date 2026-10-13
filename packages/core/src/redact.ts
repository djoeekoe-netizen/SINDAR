/** Secret hygiene: never let keys/tokens reach logs or prompts. */

export const SECRET_KEY_RE =
  /(api[-_]?key|token|secret|password|passwd|authorization|cookie|private[-_]?key)/i;

export const REDACTED = '***';

/** Values of env vars whose *names* look secret (and are long enough to be real). */
export function collectSecretValues(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!v || v.length < 8) continue;
    if (SECRET_KEY_RE.test(k)) out.push(v);
  }
  // Longest first so partial overlaps are replaced correctly.
  return out.toSorted((a, b) => b.length - a.length);
}

export function redactString(input: string, secrets: readonly string[]): string {
  let s = input;
  for (const sec of secrets) if (sec) s = s.split(sec).join(REDACTED);
  // Common bearer/key shapes even if not known.
  s = s.replace(/(bearer\s+)[a-z0-9._-]{12,}/gi, `$1${REDACTED}`);
  s = s.replace(/\b(sk|gsk|xai|sk-ant|sk-or|ghp|github_pat)[-_][a-z0-9_-]{12,}/gi, REDACTED);
  return s;
}

export function redactValue(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactString(value.message, secrets),
        stack: value.stack ? redactString(value.stack, secrets) : undefined,
      };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) && v ? REDACTED : redactValue(v, secrets, depth + 1);
    }
    return out;
  }
  return value;
}

/** Show only a hint of a key for UIs: `gsk_…9f3a`. */
export function maskKey(key: string): string {
  if (key.length <= 8) return REDACTED;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
