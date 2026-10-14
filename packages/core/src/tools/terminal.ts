import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { resolveToolPath } from './paths.js';
import { defineTool, type Tool, type ToolContext, type ToolRiskDetail } from './types.js';

/** Commands that are never executed, whatever the approval mode (ADR/§15 hard floors). */
export const FORBIDDEN_COMMANDS: Array<[RegExp, string]> = [
  [
    /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(\/|~|\$HOME|\$PREFIX|\/data\/data\/com\.termux)(\s|$|\/\*)/i,
    'recursive delete of root/home',
  ],
  [/\bmkfs(\.\w+)?\b/i, 'formatting a filesystem'],
  [/\bdd\s+.*\bof=\/dev\/(sd|mmcblk|nvme|block)/i, 'raw write to a block device'],
  [/>\s*\/dev\/(sd|mmcblk|nvme|block)/i, 'raw write to a block device'],
  [/:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;/, 'fork bomb'],
  [/\b(shutdown|reboot|halt|poweroff)\b/i, 'power control'],
  [/\bchmod\s+(-R\s+)?[0-7]*777\s+\/(\s|$)/i, 'chmod 777 on root'],
  [/\.sindar\/\.env\b/, 'touching SINDAR secrets'],
];

export const PIPE_TO_SHELL = /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i;

export function programOf(command: string): string {
  const stripped = command
    .trim()
    .replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '') // VAR=x prefix
    .replace(/^(sudo|env|nice|time|nohup)\s+/, '');
  const first = stripped.split(/[\s;|&]+/)[0] ?? '';
  return path.basename(first);
}

export function classifyCommand(command: string): ToolRiskDetail {
  for (const [re, why] of FORBIDDEN_COMMANDS)
    if (re.test(command)) return { risk: 'exec', forbidden: why, program: programOf(command) };
  return { risk: 'exec', program: programOf(command) };
}

interface BgProcess {
  id: string;
  pid: number | undefined;
  command: string;
  logFile: string;
  startedAt: number;
  child: ChildProcess;
  exitCode: number | null;
}
const background = new Map<string, BgProcess>();
let bgCounter = 0;

function spawnShell(command: string, ctx: ToolContext, cwd: string) {
  const { shell, shellArgs } = ctx.platform;
  return spawn(shell, [...shellArgs, command], {
    cwd,
    env: {
      ...ctx.env,
      SINDAR: '1',
      TERM: ctx.env.TERM ?? 'dumb',
      LANG: ctx.env.LANG ?? 'C.UTF-8',
    } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Own process group on POSIX so a timeout/cancel can kill the whole tree
    // (e.g. `sh -c "termux-battery-status"` → termux-api → …), not just the shell.
    detached: process.platform !== 'win32',
  });
}

/** Kill a child *and everything it spawned* (process group on POSIX, `taskkill /T` on Windows). */
export function killTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => undefined);
    } else child.kill();
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

export const terminal = defineTool({
  name: 'terminal',
  toolset: 'terminal',
  risk: 'exec',
  description:
    'Run a shell command and return its combined output and exit code. Non-interactive only (no prompts). Use background=true for servers/long jobs and the process tool to read their logs.',
  parameters: z.object({
    command: z.string().min(1).describe('Shell command line'),
    cwd: z.string().optional().describe('Working directory (default: current)'),
    timeout_s: z
      .number()
      .int()
      .min(1)
      .max(3600)
      .optional()
      .describe('Kill after this many seconds (default 120)'),
    background: z
      .boolean()
      .optional()
      .describe('Start detached and return a process id immediately'),
  }),
  summarize: (a) => `$ ${a.command}${a.cwd ? `  (in ${a.cwd})` : ''}`,
  classify: (a) => classifyCommand(a.command),
  async execute(args, ctx) {
    const cwd = resolveToolPath(ctx, args.cwd);
    if (!fs.existsSync(cwd)) return { content: `error: cwd does not exist: ${cwd}`, isError: true };
    if (args.background) {
      const id = `p${++bgCounter}`;
      const dir = path.join(ctx.paths.logs, 'processes');
      fs.mkdirSync(dir, { recursive: true });
      const logFile = path.join(dir, `${id}-${Date.now()}.log`);
      const out = fs.openSync(logFile, 'w');
      const child = spawnShell(args.command, ctx, cwd);
      const entry: BgProcess = {
        id,
        pid: child.pid,
        command: args.command,
        logFile,
        startedAt: Date.now(),
        child,
        exitCode: null,
      };
      child.stdout?.on('data', (d: Buffer) => fs.writeSync(out, d));
      child.stderr?.on('data', (d: Buffer) => fs.writeSync(out, d));
      child.on('exit', (code) => {
        entry.exitCode = code ?? -1;
        try {
          fs.closeSync(out);
        } catch {
          /* ignore */
        }
      });
      child.unref();
      background.set(id, entry);
      return {
        content: `started background process ${id} (pid ${child.pid}). Logs: ${logFile}. Use process {action:"read", id:"${id}"}.`,
        meta: { id, pid: child.pid },
      };
    }

    const timeoutMs = Math.min((args.timeout_s ?? ctx.limits.timeoutMs / 1000) * 1000, 3600_000);
    return new Promise((resolve) => {
      const child = spawnShell(args.command, ctx, cwd);
      const chunks: Buffer[] = [];
      let bytes = 0;
      const cap = 4 * 1024 * 1024;
      const onData = (d: Buffer) => {
        if (bytes < cap) {
          chunks.push(d);
          bytes += d.length;
        }
        const line = d.toString('utf8').trim().split('\n').pop();
        if (line) ctx.onProgress?.(line.slice(0, 120));
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      let killed: 'timeout' | 'cancelled' | undefined;
      let done = false;
      const kill = (why: 'timeout' | 'cancelled') => {
        if (killed) return;
        killed = why;
        killTree(child, 'SIGTERM');
        setTimeout(() => killTree(child, 'SIGKILL'), 2000).unref();
        // Orphaned grandchildren can keep our pipes open forever: stop waiting for them.
        setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(child.exitCode);
        }, 3000).unref();
      };
      const timer = setTimeout(() => kill('timeout'), timeoutMs);
      const onAbort = () => kill('cancelled');
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
      if (ctx.signal?.aborted) onAbort();
      const finish = (code: number | null, err?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ctx.signal?.removeEventListener('abort', onAbort);
        let output = Buffer.concat(chunks).toString('utf8');
        if (bytes >= cap) output += '\n…[output capped at 4MB]';
        const status = err
          ? `error: ${err.message}`
          : killed === 'timeout'
            ? `killed after ${timeoutMs / 1000}s timeout`
            : killed === 'cancelled'
              ? 'cancelled by user'
              : `exit code ${code}`;
        resolve({
          content: `${output.trimEnd()}${output.trim() ? '\n' : ''}[${status}]`,
          isError: Boolean(err) || killed !== undefined || (code !== 0 && code !== null),
          meta: { exitCode: code, killed },
        });
      };
      child.on('error', (e) => finish(null, e));
      child.on('close', (code) => finish(code));
    });
  },
});

export const processTool = defineTool({
  name: 'process',
  toolset: 'terminal',
  risk: 'read',
  description:
    'Manage background processes started with terminal(background=true): list them, read their log tail, or kill one.',
  parameters: z.object({
    action: z.enum(['list', 'read', 'kill']),
    id: z.string().optional().describe('Process id from terminal(background=true)'),
    tail: z.number().int().min(1).max(2000).optional().describe('Lines to read (default 100)'),
  }),
  summarize: (a) => `process ${a.action}${a.id ? ` ${a.id}` : ''}`,
  classify: (a) => ({ risk: a.action === 'kill' ? 'exec' : 'read', program: 'process' }),
  async execute(args) {
    if (args.action === 'list') {
      if (background.size === 0) return { content: 'no background processes' };
      return {
        content: [...background.values()]
          .map(
            (p) =>
              `${p.id}\tpid ${p.pid}\t${p.exitCode === null ? 'running' : `exited ${p.exitCode}`}\t${Math.round((Date.now() - p.startedAt) / 1000)}s\t${p.command}`,
          )
          .join('\n'),
      };
    }
    const p = args.id ? background.get(args.id) : undefined;
    if (!p)
      return { content: `error: unknown process id ${args.id ?? '(missing)'}`, isError: true };
    if (args.action === 'kill') {
      if (p.exitCode !== null) return { content: `${p.id} already exited (${p.exitCode})` };
      killTree(p.child, 'SIGTERM');
      setTimeout(() => killTree(p.child, 'SIGKILL'), 2000).unref();
      return { content: `sent SIGTERM to ${p.id} (pid ${p.pid})` };
    }
    const text = fs.existsSync(p.logFile) ? fs.readFileSync(p.logFile, 'utf8') : '';
    const lines = text.split('\n');
    const tail = lines.slice(-(args.tail ?? 100)).join('\n');
    return {
      content: `[${p.id} ${p.exitCode === null ? 'running' : `exited ${p.exitCode}`}]\n${tail}`,
    };
  },
});

/** Test/cleanup helper. */
export function killAllBackground(): void {
  for (const p of background.values()) if (p.exitCode === null) killTree(p.child, 'SIGKILL');
  background.clear();
}

export const TERMINAL_TOOLS: Tool[] = [terminal as Tool, processTool as Tool];
