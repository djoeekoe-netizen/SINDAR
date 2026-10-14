import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const TOKEN_FILE = 'gateway.token';

export function tokenPath(home: string): string {
  return path.join(home, TOKEN_FILE);
}

/** Read the gateway token, creating a random one (0600) on first use. */
export function loadOrCreateToken(home: string): string {
  const file = tokenPath(home);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* create below */
  }
  const token = randomBytes(24).toString('base64url');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* windows */
  }
  return token;
}

/** Replace the token (e.g. `sindar gateway token --rotate`). */
export function rotateToken(home: string): string {
  const file = tokenPath(home);
  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
  return loadOrCreateToken(home);
}
