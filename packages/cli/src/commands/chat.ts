import type { Command } from 'commander';
import readline from 'node:readline';
import pc from 'picocolors';
import {
  AgentError,
  createPolicyState,
  runTurn,
  t,
  type ApprovalAnswer,
  type ApprovalRequest,
  type ApprovalMode,
  type Session,
} from '@sindar/core';
import { bootstrap, type App } from '../app.js';
import { createChatView } from '../ui/chat-view.js';

interface ChatOpts {
  model?: string;
  continue?: boolean;
  resume?: string;
  approval?: string;
  yolo?: boolean;
  cwd?: string;
  quiet?: boolean;
}

const APPROVAL_MODES: ApprovalMode[] = ['ask', 'allowlist', 'yolo'];

function relativeTime(ms: number, lang: 'ar' | 'en'): string {
  const d = Date.now() - ms;
  const m = Math.round(d / 60000);
  if (m < 1) return lang === 'ar' ? 'الآن' : 'now';
  if (m < 60) return lang === 'ar' ? `قبل ${m} د` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return lang === 'ar' ? `قبل ${h} س` : `${h}h ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

export function formatSessions(app: App, limit = 15): string {
  const rows = app.store.list({ limit });
  if (rows.length === 0) return t(app.lang, 'sessions.none');
  return [
    t(app.lang, 'sessions.title'),
    ...rows.map((s) =>
      t(app.lang, 'sessions.row', {
        id: s.id.slice(0, 8),
        when: relativeTime(s.updatedAt, app.lang).padEnd(10),
        count: String(s.messageCount).padStart(3),
        model: (s.model ?? '-').padEnd(28),
        title: s.title ?? '',
      }),
    ),
  ].join('\n');
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8').trim();
}

export function registerChat(program: Command): void {
  program
    .command('chat [message...]')
    .description('talk to SINDAR — interactive, or one-shot when a message is given / المحادثة')
    .option('-m, --model <ref>', 'model for this session, e.g. groq:llama-3.3-70b-versatile')
    .option('-c, --continue', 'resume the most recent session')
    .option('-r, --resume <id>', 'resume a session by id (prefix is enough)')
    .option('-a, --approval <mode>', 'ask | allowlist | yolo')
    .option('--yolo', 'shortcut for --approval yolo')
    .option('--cwd <dir>', 'working directory for tools (default: current directory)')
    .option('-q, --quiet', 'hide tool output previews')
    .action(async (words: string[], opts: ChatOpts, cmd: Command) => {
      const g = cmd.optsWithGlobals<{ home?: string; lang?: string }>();
      const app = await bootstrap({ home: g.home, lang: g.lang });
      try {
        const oneShot = words.join(' ').trim() || (await readStdin());
        const code = oneShot
          ? await runOneShot(app, oneShot, opts)
          : await runInteractive(app, opts);
        process.exitCode = code;
      } finally {
        await app.close();
      }
    });
}

function resolveApproval(app: App, opts: ChatOpts, session?: Session): ApprovalMode {
  const fromFlag = opts.yolo ? 'yolo' : opts.approval;
  if (fromFlag && APPROVAL_MODES.includes(fromFlag as ApprovalMode))
    return fromFlag as ApprovalMode;
  if (session?.approvalMode && APPROVAL_MODES.includes(session.approvalMode as ApprovalMode))
    return session.approvalMode as ApprovalMode;
  return app.config.agent.approvalMode;
}

function pickSession(
  app: App,
  opts: ChatOpts,
  cwd: string,
): { session: Session; resumed: boolean } {
  if (opts.resume) {
    const s = app.store.find(opts.resume);
    if (!s) throw new Error(t(app.lang, 'sessions.notfound', { id: opts.resume }));
    return { session: s, resumed: true };
  }
  if (opts.continue) {
    const s = app.store.last('cli');
    if (s) return { session: s, resumed: true };
  }
  const mode = resolveApproval(app, opts);
  return {
    session: app.store.create({
      channel: 'cli',
      cwd,
      model: opts.model,
      approvalMode: opts.yolo || opts.approval ? mode : undefined,
    }),
    resumed: false,
  };
}

async function runOneShot(app: App, message: string, opts: ChatOpts): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const { session } = pickSession(app, opts, cwd);
  const policy = createPolicyState(resolveApproval(app, opts, session), app.config.agent.allowlist);
  const view = createChatView(app.lang, process.stdout, { quiet: opts.quiet });
  const ac = new AbortController();
  process.once('SIGINT', () => ac.abort());
  try {
    await runTurn(app, {
      session,
      input: message,
      modelRef: opts.model,
      policy,
      cwd,
      onEvent: (ev) => view.onEvent(ev),
      requestApproval: (req) => askApprovalOnce(app, view, req),
      signal: ac.signal,
    });
    view.flush();
    return 0;
  } catch (err) {
    view.flush();
    process.stderr.write(
      `${pc.red(t(app.lang, 'chat.error', { error: (err as Error).message }))}\n`,
    );
    if (err instanceof AgentError && /no API key/i.test(err.message))
      process.stderr.write(`${t(app.lang, 'chat.error.nokey')}\n`);
    return 1;
  }
}

function parseApproval(answer: string): ApprovalAnswer {
  const a = answer.trim().toLowerCase();
  if (['a', 'always', 'دائما', 'دائماً'].includes(a)) return 'always';
  if (['y', 'yes', 'نعم', 'موافق'].includes(a)) return 'allow';
  return 'deny';
}

/** One-shot mode on a TTY: ask on the terminal; piped/non-TTY input can't approve anything. */
async function askApprovalOnce(
  app: App,
  view: ReturnType<typeof createChatView>,
  req: ApprovalRequest,
): Promise<ApprovalAnswer> {
  if (!process.stdin.isTTY) return 'deny';
  process.stdout.write(`\n${view.approvalText(req)}\n`);
  const tmp = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) =>
      tmp.question(t(app.lang, 'chat.approve.prompt'), resolve),
    );
    return parseApproval(answer);
  } finally {
    tmp.close();
  }
}

async function runInteractive(app: App, opts: ChatOpts): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  let { session, resumed } = pickSession(app, opts, cwd);
  let modelRef = opts.model;
  const policy = createPolicyState(resolveApproval(app, opts, session), app.config.agent.allowlist);
  const view = createChatView(app.lang, process.stdout, { quiet: opts.quiet });
  const out = (s: string) => process.stdout.write(`${s}\n`);
  const dim = (s: string) => (process.stdout.isTTY ? pc.dim(s) : s);

  const announce = () => {
    const model = modelRef ?? session.model ?? app.config.model.default;
    out(
      dim(
        resumed
          ? t(app.lang, 'chat.session.resumed', {
              id: session.id.slice(0, 8),
              count: app.store.count(session.id),
              model,
            })
          : t(app.lang, 'chat.session.new', { id: session.id.slice(0, 8), model }),
      ),
    );
  };
  out(dim(t(app.lang, 'chat.hint')));
  announce();
  if (resumed) {
    // Show the tail of the conversation so the user remembers where they were.
    const tail = app.store
      .messages(session.id)
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
      .slice(-4);
    for (const m of tail)
      out(
        dim(
          `${m.role === 'user' ? '›' : '‹'} ${String(typeof m.content === 'string' ? m.content : '')
            .replace(/\s+/g, ' ')
            .slice(0, 160)}`,
        ),
      );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
    historySize: 200,
  });
  const promptStr = process.stdout.isTTY ? pc.bold(pc.cyan('› ')) : '› ';
  rl.setPrompt(promptStr);
  let current: AbortController | undefined;
  let lastUser = '';
  let closed = false;
  // Lines typed while a reply is streaming are queued (not lost); a pending approval question
  // takes the next line as its answer.
  const queue: string[] = [];
  let waitingForAnswer: ((line: string) => void) | undefined;
  let busy = false;

  const askLine = (question: string) =>
    new Promise<string>((resolve) => {
      process.stdout.write(question);
      // A line typed ahead (before the question appeared) answers it.
      if (queue.length) {
        resolve(queue.shift()!);
        return;
      }
      waitingForAnswer = resolve;
    });

  rl.on('SIGINT', () => {
    if (current) {
      current.abort();
      return;
    }
    out(`\n${t(app.lang, 'chat.bye')}`);
    closed = true;
    rl.close();
  });

  const turn = async (text: string) => {
    lastUser = text;
    current = new AbortController();
    try {
      await runTurn(app, {
        session,
        input: text,
        modelRef,
        policy,
        cwd,
        onEvent: (ev) => view.onEvent(ev),
        requestApproval: async (req) => {
          process.stdout.write(`\n${view.approvalText(req)}\n`);
          return parseApproval(await askLine(t(app.lang, 'chat.approve.prompt')));
        },
        signal: current.signal,
      });
    } catch (err) {
      view.flush();
      out(pc.red(t(app.lang, 'chat.error', { error: (err as Error).message })));
      if (/no API key/i.test((err as Error).message)) out(t(app.lang, 'chat.error.nokey'));
    } finally {
      view.flush();
      current = undefined;
    }
  };

  const slash = async (line: string): Promise<boolean> => {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case 'exit':
      case 'quit':
      case 'q':
        out(t(app.lang, 'chat.bye'));
        closed = true;
        rl.close();
        return true;
      case 'help':
      case '?':
        out(t(app.lang, 'chat.help'));
        return true;
      case 'new':
        session = app.store.create({ channel: 'cli', cwd, model: modelRef });
        resumed = false;
        policy.sessionAllowed.clear();
        announce();
        return true;
      case 'model':
        if (arg) {
          try {
            app.registry.target(arg);
            modelRef = arg;
            app.store.update(session.id, { model: arg });
            out(t(app.lang, 'chat.model.set', { model: arg }));
          } catch (err) {
            out(pc.red((err as Error).message));
          }
        } else
          out(
            t(app.lang, 'chat.model.set', {
              model: modelRef ?? session.model ?? app.config.model.default,
            }),
          );
        return true;
      case 'approve':
      case 'approval':
        if (APPROVAL_MODES.includes(arg as ApprovalMode)) {
          policy.mode = arg as ApprovalMode;
          app.store.update(session.id, { approvalMode: arg });
        }
        out(t(app.lang, 'chat.approval.set', { mode: policy.mode }));
        return true;
      case 'usage': {
        const rows = app.store.usage(session.id);
        if (rows.length === 0) out(t(app.lang, 'chat.usage.none'));
        for (const r of rows)
          out(
            `${r.provider}:${r.model} — ${t(app.lang, 'chat.usage', { in: r.tokensIn, out: r.tokensOut, calls: r.calls })}`,
          );
        return true;
      }
      case 'undo': {
        const removed = app.store.undoLastTurn(session.id);
        out(removed === undefined ? t(app.lang, 'chat.undo.none') : t(app.lang, 'chat.undo.ok'));
        return true;
      }
      case 'retry': {
        const removed = app.store.undoLastTurn(session.id) ?? lastUser;
        if (!removed) {
          out(t(app.lang, 'chat.retry.none'));
          return true;
        }
        await turn(removed);
        return true;
      }
      case 'compress': {
        const before = app.store.get(session.id)!;
        if (app.store.messages(session.id, { afterSeq: before.summaryUpto }).length < 4) {
          out(t(app.lang, 'chat.compress.skip'));
          return true;
        }
        const saved = app.config.agent.contextWindow;
        // Force compression by pretending the window is tiny for one turn.
        (app.config.agent as { contextWindow?: number }).contextWindow = 1;
        try {
          await runTurn(app, {
            session,
            input: 'Summarize our conversation so far in 3 lines.',
            modelRef,
            policy,
            cwd,
            onEvent: (ev) => view.onEvent(ev),
            signal: new AbortController().signal,
          });
        } finally {
          (app.config.agent as { contextWindow?: number }).contextWindow = saved;
        }
        out(dim(t(app.lang, 'chat.compress.done')));
        return true;
      }
      case 'sessions':
        out(formatSessions(app));
        return true;
      default:
        out(t(app.lang, 'chat.help'));
        return true;
    }
  };

  const pump = async () => {
    if (busy) return;
    busy = true;
    try {
      while (queue.length && !closed) {
        const line = queue.shift()!.trim();
        if (!line) continue;
        if (line.startsWith('/')) await slash(line);
        else await turn(line);
      }
    } finally {
      busy = false;
      if (!closed) rl.prompt();
    }
  };

  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      closed = true;
      resolve();
    });
    rl.on('line', (line) => {
      if (waitingForAnswer) {
        const w = waitingForAnswer;
        waitingForAnswer = undefined;
        w(line);
        return;
      }
      queue.push(line);
      void pump();
    });
    rl.prompt();
  });
  return 0;
}
