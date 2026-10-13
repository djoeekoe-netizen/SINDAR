import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from '../platform.js';
import type { ToolContext } from './types.js';

export function resolveToolPath(ctx: ToolContext, p: string | undefined): string {
  const raw = (p ?? '.').trim() || '.';
  const expanded = expandHome(raw, ctx.platform.home);
  return path.resolve(ctx.cwd, expanded);
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Files SINDAR itself must never let the model touch. */
export function isProtectedPath(ctx: ToolContext, abs: string): string | undefined {
  const protectedFiles = [
    ctx.paths.env,
    ctx.paths.db,
    `${ctx.paths.db}-wal`,
    `${ctx.paths.db}-shm`,
  ];
  if (protectedFiles.some((f) => path.resolve(f) === abs))
    return 'SINDAR secrets/database are protected';
  const base = path.basename(abs);
  if (
    /^(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$/.test(base) ||
    abs.includes(`${path.sep}.ssh${path.sep}`)
  )
    return 'SSH keys are protected';
  if (/\.(pem|key|p12|pfx)$/i.test(base) && !isInside(ctx.workspace, abs))
    return 'private key files are protected';
  return undefined;
}

export function outsideWorkspace(ctx: ToolContext, abs: string): boolean {
  return !(isInside(ctx.workspace, abs) || isInside(ctx.cwd, abs));
}

export function statSafe(p: string): fs.Stats | undefined {
  try {
    return fs.statSync(p);
  } catch {
    return undefined;
  }
}

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i]!;
    if (c === 0) return true;
    if (c < 7 || (c > 14 && c < 32)) suspicious++;
  }
  return n > 0 && suspicious / n > 0.3;
}
