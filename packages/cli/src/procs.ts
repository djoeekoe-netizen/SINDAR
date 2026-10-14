import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveHome } from '@sindar/core';

export interface ProcessInfo {
  pid: number;
  args: string[];
}

/** `/proc/<pid>/cmdline` is NUL-separated. */
export function parseCmdline(raw: string | Buffer): string[] {
  const parts = String(raw).split('\0');
  while (parts.length && parts.at(-1) === '') parts.pop();
  return parts;
}

/** Processes visible to this user (Linux/Termux via /proc, otherwise `ps`). Best effort. */
export function listProcesses(): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  if (fs.existsSync('/proc')) {
    for (const name of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const args = parseCmdline(fs.readFileSync(`/proc/${name}/cmdline`));
        if (args.length) out.push({ pid: Number(name), args });
      } catch {
        /* vanished or not ours */
      }
    }
    return out;
  }
  if (process.platform === 'win32') return out;
  try {
    const text = execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' });
    for (const line of text.split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (m) out.push({ pid: Number(m[1]), args: m[2]!.trim().split(/\s+/) });
    }
  } catch {
    /* no ps */
  }
  return out;
}

function homeFlag(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--home') return args[i + 1];
    if (a.startsWith('--home=')) return a.slice('--home='.length);
  }
  return undefined;
}

/**
 * Does this command line belong to a SINDAR brain serving `home`? Matches
 * `node …/sindar gateway run`, `node …/dist/index.js --home X gateway run`, and
 * `… gateway start -f|--foreground`, whoever launched them (terminal, app connect, Android app).
 */
export function looksLikeGatewayProcess(
  args: string[],
  home: string,
  defaultHome: string = resolveHome(),
): boolean {
  if (args.length < 3) return false;
  if (!/^node(?:\d+)?(?:\.exe)?$/i.test(path.basename(args[0]!))) return false;
  const entry = args[1] ?? '';
  if (!/sindar|[\\/]dist[\\/]index\.js$/i.test(entry)) return false;
  const i = args.indexOf('gateway', 2);
  if (i < 0) return false;
  const sub = args[i + 1];
  const foreground =
    sub === 'run' ||
    ((sub === 'start' || sub === undefined || sub.startsWith('-')) &&
      args.some((a) => a === '-f' || a === '--foreground'));
  if (!foreground) return false;
  const procHome = homeFlag(args);
  const want = path.resolve(home);
  if (procHome) return path.resolve(procHome) === want;
  return path.resolve(defaultHome) === want;
}

export function findGatewayProcesses(home: string, defaultHome?: string): ProcessInfo[] {
  const me = new Set([process.pid, process.ppid]);
  return listProcesses().filter(
    (p) => !me.has(p.pid) && looksLikeGatewayProcess(p.args, home, defaultHome),
  );
}

/** Linux: a zombie (exited, not yet reaped by its parent) still answers `kill(pid, 0)`. */
function isZombie(pid: number): boolean {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
    return state === 'Z' || state === 'X';
  } catch {
    return false;
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
  return !isZombie(pid);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SIGTERM, wait up to `graceMs`, then SIGKILL. Resolves true when the process is gone. */
export async function killAndWait(pid: number, graceMs = 8000): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return !processAlive(pid);
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && processAlive(pid)) await sleep(200);
  if (processAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
    const hard = Date.now() + 3000;
    while (Date.now() < hard && processAlive(pid)) await sleep(100);
  }
  return !processAlive(pid);
}
