/**
 * Platform detection and portable OS helpers.
 *
 * ADR-16 (Termux compatibility): NEVER hardcode `/bin/sh`, `/tmp` or `/usr/...`.
 * Always go through this module for shells, temp dirs and executable lookup.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export type OsKind = 'android' | 'linux' | 'darwin' | 'windows' | 'unknown';

export interface PlatformInfo {
  os: OsKind;
  /** True when running inside Termux on Android. */
  isTermux: boolean;
  termuxVersion?: string;
  /** Termux `$PREFIX` (e.g. /data/data/com.termux/files/usr). */
  prefix?: string;
  arch: string;
  nodeVersion: string;
  /** Default shell executable used to run commands. */
  shell: string;
  /** Arguments that make the shell execute a command string. */
  shellArgs: string[];
  home: string;
  tmp: string;
  release: string;
}

type Env = Record<string, string | undefined>;

export function isTermuxEnv(env: Env = process.env): boolean {
  if (env.TERMUX_VERSION) return true;
  if (env.PREFIX && env.PREFIX.includes('/com.termux/')) return true;
  if (process.platform === 'android') return true;
  return false;
}

function exists(p: string | undefined): p is string {
  if (!p) return false;
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function detectOs(env: Env = process.env): OsKind {
  if (isTermuxEnv(env) || process.platform === 'android') return 'android';
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

/** Pick a shell that actually exists on this machine (Termux has no /bin/sh). */
export function resolveShell(env: Env = process.env): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c'] };
  }
  const candidates: string[] = [];
  if (env.SHELL) candidates.push(env.SHELL);
  if (isTermuxEnv(env)) {
    const prefix = env.PREFIX || '/data/data/com.termux/files/usr';
    candidates.push(path.join(prefix, 'bin', 'bash'), path.join(prefix, 'bin', 'sh'));
  }
  candidates.push('/bin/bash', '/usr/bin/bash', '/bin/sh', '/usr/bin/sh');
  for (const c of candidates) if (exists(c)) return { shell: c, args: ['-c'] };
  // Last resort: rely on PATH lookup by the OS.
  return { shell: 'sh', args: ['-c'] };
}

export function detectPlatform(env: Env = process.env): PlatformInfo {
  const termux = isTermuxEnv(env);
  const { shell, args } = resolveShell(env);
  return {
    os: detectOs(env),
    isTermux: termux,
    termuxVersion: termux ? env.TERMUX_VERSION : undefined,
    prefix: termux ? env.PREFIX || '/data/data/com.termux/files/usr' : undefined,
    arch: process.arch,
    nodeVersion: process.versions.node,
    shell,
    shellArgs: args,
    home: os.homedir(),
    tmp: os.tmpdir(),
    release: os.release(),
  };
}

/** Cross-platform `which` without spawning a process. */
export function commandExists(name: string, env: Env = process.env): string | undefined {
  const pathVar = env.PATH || env.Path || '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      if (exists(full)) return full;
      if (process.platform === 'win32' && exists(path.join(dir, name))) return path.join(dir, name);
    }
  }
  return undefined;
}

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string, home: string = os.homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
