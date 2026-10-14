import { computed, signal, type Signal } from '@preact/signals';
import type {
  ApprovalAnswer,
  ApprovalDTO,
  EventDTO,
  FileRefDTO,
  MessageDTO,
  ModelsDTO,
  PublicConfigDTO,
  ServerMessage,
  SessionDTO,
} from '../../../gateway/src/protocol.ts';
import { Api, ApiError, loadConnection, saveConnection, type Connection } from './api.ts';
import { GatewaySocket, type SocketStatus } from './ws.ts';
import { t, type Lang } from './i18n.ts';

// ---------------------------------------------------------------------------
// Conversation items (what the chat view renders)
// ---------------------------------------------------------------------------

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  ts: number;
}
export interface AssistantItem {
  kind: 'assistant';
  id: string;
  text: Signal<string>;
  reasoning: Signal<string>;
  streaming: Signal<boolean>;
  ts: number;
}
export type ToolStatus = 'running' | 'done' | 'error' | 'denied';
export interface ToolItem {
  kind: 'tool';
  id: string;
  name: string;
  summary: string;
  args: string;
  status: Signal<ToolStatus>;
  output: Signal<string>;
  progress: Signal<string>;
  ms: Signal<number | undefined>;
  truncated: boolean;
  reason?: string;
  /** Files produced by the tool (download links). */
  files: Signal<FileRefDTO[]>;
}
export interface ApprovalItem {
  kind: 'approval';
  id: string;
  approval: Signal<ApprovalDTO>;
}
export interface NoticeItem {
  kind: 'notice';
  id: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}
export type Item = UserItem | AssistantItem | ToolItem | ApprovalItem | NoticeItem;

// ---------------------------------------------------------------------------
// Global state (signals)
// ---------------------------------------------------------------------------

const LANG_KEY = 'sindar.lang';
const THEME_KEY = 'sindar.theme';
const REASONING_KEY = 'sindar.reasoning';

export const conn = signal<Connection | undefined>(loadConnection());
export const authed = signal(false);
export const socketStatus = signal<SocketStatus>('closed');
export const connectError = signal<string | undefined>(undefined);
export const config = signal<PublicConfigDTO | undefined>(undefined);
export const localLang = signal<Lang>((localStorage.getItem(LANG_KEY) as Lang) || 'ar');
export const lang = computed<Lang>(() => config.value?.language ?? localLang.value);
export const theme = signal<'dark' | 'light' | 'system'>(
  (localStorage.getItem(THEME_KEY) as 'dark' | 'light' | 'system') || 'dark',
);
export const showReasoning = signal(localStorage.getItem(REASONING_KEY) === '1');

export const sessions = signal<SessionDTO[]>([]);
export const currentId = signal<string | undefined>(undefined);
export const items = signal<Item[]>([]);
export const loadingHistory = signal(false);
export const running = signal<ReadonlySet<string>>(new Set());
export const pending = signal<ApprovalDTO[]>([]);
export const models = signal<ModelsDTO | undefined>(undefined);
export const sidebarOpen = signal(false);
export const settingsOpen = signal(false);
export const memoryOpen = signal(false);
export const skillsOpen = signal(false);
export const channelsOpen = signal(false);
export const modelPickerOpen = signal(false);
export const toast = signal<string | undefined>(undefined);
export const version = signal<{ version: string; build: string } | undefined>(undefined);
/** True when the gateway runs a newer build than this page (after `sindar update`). */
export const staleUi = signal(false);
/** A turn is running but nothing arrived for a while — on phones that usually means Android froze Termux. */
export const stalled = signal(false);
const STALL_MS = 30_000;
let lastTurnActivity = 0;
function touchTurn(): void {
  lastTurnActivity = Date.now();
  if (stalled.value) stalled.value = false;
}
const stallTimer = setInterval(() => {
  if (!isRunning.value || socketStatus.value !== 'open') {
    if (stalled.value) stalled.value = false;
    return;
  }
  if (lastTurnActivity && Date.now() - lastTurnActivity > STALL_MS) stalled.value = true;
}, 5000);
(stallTimer as unknown as { unref?: () => void }).unref?.();

const UI_BUILD: string = typeof __UI_BUILD__ === 'undefined' ? 'local' : __UI_BUILD__;
const RELOAD_KEY = 'sindar.reloadedFor';

/** Reload the page to pick up a new UI build (asks the service worker to refresh first). */
export function reloadApp(): void {
  const done = () => location.reload();
  try {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistration()
        .then((r) => r?.update())
        .catch(() => undefined)
        .finally(done);
      return;
    }
  } catch {
    /* fall through */
  }
  done();
}

/**
 * The PWA can stay alive for days on a phone; when the brain restarts on a newer build, the
 * old page would keep running stale JavaScript. Reload once automatically (never mid-turn),
 * and show a banner if that is not enough.
 */
function checkUiBuild(serverBuild: string): void {
  if (UI_BUILD === 'local' || serverBuild === 'local' || serverBuild === UI_BUILD) {
    staleUi.value = false;
    return;
  }
  staleUi.value = true;
  let already: string | null = null;
  try {
    already = sessionStorage.getItem(RELOAD_KEY);
  } catch {
    /* private mode */
  }
  if (already === serverBuild || isRunning.value) return;
  try {
    sessionStorage.setItem(RELOAD_KEY, serverBuild);
  } catch {
    /* ignore */
  }
  reloadApp();
}

export const currentSession = computed(() => sessions.value.find((s) => s.id === currentId.value));
export const isRunning = computed(() =>
  Boolean(currentId.value && running.value.has(currentId.value)),
);
export const currentModel = computed(
  () => currentSession.value?.model ?? config.value?.model.default ?? '',
);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(msg: string, ms = 2200): void {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = undefined), ms);
}

export function applyTheme(): void {
  const mode = theme.value;
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f2a3a' : '#f3f6f8');
}

export function applyLang(): void {
  const l = lang.value;
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
}

// ---------------------------------------------------------------------------
// Controller: owns the API + socket, applies server messages to the signals
// ---------------------------------------------------------------------------

let api: Api | undefined;
let socket: GatewaySocket | undefined;
let currentAssistant: AssistantItem | undefined;
let seq = 0;
const nid = () => `i${++seq}`;

export function getApi(): Api | undefined {
  return api;
}

function upsertSession(s: SessionDTO): void {
  const list = sessions.value.filter((x) => x.id !== s.id);
  list.unshift(s);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  sessions.value = list;
}

function setRunning(id: string, on: boolean): void {
  const next = new Set(running.value);
  if (on) next.add(id);
  else next.delete(id);
  running.value = next;
}

function push(item: Item): void {
  items.value = [...items.value, item];
}

function newAssistant(): AssistantItem {
  // Never leave a previous bubble spinning forever.
  finishAssistant();
  const a: AssistantItem = {
    kind: 'assistant',
    id: nid(),
    text: signal(''),
    reasoning: signal(''),
    streaming: signal(true),
    ts: Date.now(),
  };
  currentAssistant = a;
  push(a);
  return a;
}

function finishAssistant(): void {
  if (currentAssistant) currentAssistant.streaming.value = false;
  currentAssistant = undefined;
}

function findTool(id: string): ToolItem | undefined {
  for (let i = items.value.length - 1; i >= 0; i--) {
    const it = items.value[i];
    if (it?.kind === 'tool' && it.id === id) return it;
  }
  return undefined;
}

function notice(level: NoticeItem['level'], text: string): void {
  const last = items.value[items.value.length - 1];
  if (last?.kind === 'notice' && last.text === text) return;
  push({ kind: 'notice', id: nid(), level, text });
}

const NETWORK_RE =
  /fetch failed|UND_ERR|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|idle timeout/i;
export const isNetworkError = (message: string): boolean => NETWORK_RE.test(message);

export function friendlyError(message: string, code?: string): string {
  const l = lang.value;
  if (code === 'rate_limit' || /HTTP 429|rate limit/i.test(message))
    return t(l, 'error.rate_limit');
  if (code === 'network' || isNetworkError(message)) {
    const m = /\(([A-Z_]+)\)/.exec(message);
    return t(l, 'error.network', { message: m?.[1] ?? message.slice(0, 80) });
  }
  if (/no API key/i.test(message)) return t(l, 'error.nokey');
  if (code === 'auth' || /HTTP 401|HTTP 403/.test(message)) return t(l, 'error.auth');
  return t(l, 'error.generic', {
    message: message.length > 240 ? `${message.slice(0, 240)}…` : message,
  });
}

function applyEvent(ev: EventDTO): void {
  switch (ev.type) {
    case 'text': {
      const a = currentAssistant ?? newAssistant();
      a.text.value += ev.delta;
      break;
    }
    case 'reasoning': {
      const a = currentAssistant ?? newAssistant();
      a.reasoning.value += ev.delta;
      break;
    }
    case 'tool_start': {
      finishAssistant();
      const existing = findTool(ev.call.id);
      if (existing) break;
      push({
        kind: 'tool',
        id: ev.call.id,
        name: ev.call.name,
        summary: ev.summary,
        args: prettyJson(ev.call.arguments),
        status: signal<ToolStatus>('running'),
        output: signal(''),
        progress: signal(''),
        ms: signal<number | undefined>(undefined),
        truncated: false,
        files: signal<FileRefDTO[]>([]),
      });
      break;
    }
    case 'tool_progress': {
      const tool = findTool(ev.callId);
      if (tool) tool.progress.value = ev.line;
      break;
    }
    case 'tool_end': {
      const tool = findTool(ev.callId);
      if (!tool) break;
      tool.output.value = ev.content;
      tool.ms.value = ev.ms;
      tool.truncated = ev.truncated;
      if (ev.files?.length) tool.files.value = ev.files;
      tool.status.value = ev.isError ? 'error' : 'done';
      tool.progress.value = '';
      break;
    }
    case 'tool_denied': {
      finishAssistant();
      const tool = findTool(ev.call.id);
      if (tool) {
        tool.status.value = 'denied';
        tool.reason = ev.reason;
      } else {
        push({
          kind: 'tool',
          id: ev.call.id,
          name: ev.call.name,
          summary: ev.summary,
          args: prettyJson(ev.call.arguments),
          status: signal<ToolStatus>('denied'),
          output: signal(''),
          progress: signal(''),
          ms: signal<number | undefined>(undefined),
          truncated: false,
          files: signal<FileRefDTO[]>([]),
          reason: ev.reason,
        });
      }
      break;
    }
    case 'model_switch':
      notice(
        'warn',
        t(lang.value, 'notice.model_switch', { to: ev.to, reason: shortReason(ev.reason) }),
      );
      break;
    case 'compress':
      notice(
        'info',
        t(lang.value, 'notice.compress', { before: ev.beforeTokens, after: ev.afterTokens }),
      );
      break;
    case 'retry_wait':
      notice(
        'warn',
        t(
          lang.value,
          isNetworkError(ev.reason) ? 'notice.retry_wait.network' : 'notice.retry_wait',
          {
            model: ev.model,
            seconds: ev.seconds,
            attempt: ev.attempt,
          },
        ),
      );
      break;
    case 'notice':
      notice('info', ev.message);
      break;
    case 'skill_saved': {
      const text = t(
        lang.value,
        ev.action === 'created' ? 'skills.saved.notice' : 'skills.updated.notice',
        { name: ev.name },
      );
      notice('info', text);
      showToast(text, 3500);
      break;
    }
    case 'error':
      finishAssistant();
      notice('error', friendlyError(ev.message, ev.code));
      break;
    case 'done':
      // The final text is authoritative: if a flaky connection made us miss or repeat a delta,
      // snap the bubble back to what the gateway actually stored.
      if (
        currentAssistant &&
        ev.text &&
        currentAssistant.text.value &&
        currentAssistant.text.value !== ev.text
      ) {
        currentAssistant.text.value = ev.text;
      }
      finishAssistant();
      if (ev.finishReason === 'length') notice('warn', t(lang.value, 'notice.length'));
      else if (ev.finishReason === 'cancelled') notice('info', t(lang.value, 'chat.cancelled'));
      break;
    case 'usage':
    default:
      break;
  }
}

function shortReason(reason: string): string {
  if (/HTTP 429|rate limit/i.test(reason)) return t(lang.value, 'reason.rate_limit');
  if (isNetworkError(reason)) return t(lang.value, 'reason.network');
  const m = /HTTP \d+/.exec(reason);
  return m ? m[0] : reason.length > 60 ? `${reason.slice(0, 60)}…` : reason;
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

let optimisticRef: string | undefined;

/**
 * Duplicate guard. Each turn's events carry a running `seq`; anything we already applied
 * (a replayed frame, a second socket during a reconnect…) is dropped instead of rendered twice.
 */
const turnSeq = new Map<string, number>();
const startedTurns = new Set<string>();
const endedTurns = new Set<string>();

function rememberTurn(set: Set<string>, id: string): boolean {
  if (set.has(id)) return false;
  if (set.size > 200) set.clear();
  set.add(id);
  return true;
}

function freshEvent(turnId: string, n: number | undefined): boolean {
  if (n === undefined) return true;
  const last = turnSeq.get(turnId) ?? 0;
  if (n <= last) return false;
  if (turnSeq.size > 200) turnSeq.clear();
  turnSeq.set(turnId, n);
  return true;
}

function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'hello':
      config.value = msg.config;
      version.value = { version: msg.version, build: msg.build };
      pending.value = msg.pending;
      running.value = new Set(msg.running);
      applyLang();
      checkUiBuild(msg.build);
      touchTurn();
      // A reconnect may have missed the end of a turn: refresh what we show.
      if (currentId.value && !msg.running.includes(currentId.value) && currentAssistant) {
        void loadHistory(currentId.value);
      }
      void refreshSessions();
      break;
    case 'turn_start': {
      setRunning(msg.sessionId, true);
      upsertSession(msg.session);
      touchTurn();
      if (!rememberTurn(startedTurns, msg.turnId)) break;
      const mine = msg.clientRef && msg.clientRef === optimisticRef;
      if (mine) optimisticRef = undefined;
      if (!currentId.value && mine) currentId.value = msg.sessionId;
      if (msg.sessionId !== currentId.value) break;
      if (!mine) push({ kind: 'user', id: nid(), text: msg.text, ts: Date.now() });
      newAssistant();
      break;
    }
    case 'event':
      touchTurn();
      if (msg.sessionId !== currentId.value) break;
      if (!freshEvent(msg.turnId, msg.seq)) break;
      applyEvent(msg.event);
      break;
    case 'approval': {
      touchTurn();
      pending.value = [...pending.value.filter((p) => p.id !== msg.approval.id), msg.approval];
      if (
        msg.approval.sessionId === currentId.value &&
        !items.value.some((it) => it.kind === 'approval' && it.id === msg.approval.id)
      ) {
        finishAssistant();
        push({ kind: 'approval', id: msg.approval.id, approval: signal(msg.approval) });
      }
      break;
    }
    case 'approval_resolved': {
      pending.value = pending.value.filter((p) => p.id !== msg.id);
      for (const it of items.value) {
        if (it.kind === 'approval' && it.id === msg.id)
          it.approval.value = { ...it.approval.value, answer: msg.answer };
      }
      break;
    }
    case 'turn_end': {
      setRunning(msg.sessionId, false);
      touchTurn();
      if (msg.sessionId !== currentId.value) break;
      if (!rememberTurn(endedTurns, msg.turnId)) break;
      const hadStream = Boolean(currentAssistant) || items.value.length > 0;
      finishAssistant();
      if (!msg.ok && msg.error) notice('error', friendlyError(msg.error.message, msg.error.code));
      // Opened mid-turn (no streamed content captured): reload the final transcript.
      if (!hadStream) void loadHistory(msg.sessionId);
      // Drop empty assistant bubbles (e.g. a turn that only ran tools).
      items.value = items.value.filter(
        (it) => !(it.kind === 'assistant' && !it.text.value && !it.streaming.value),
      );
      break;
    }
    case 'session':
      if (msg.action === 'deleted') {
        sessions.value = sessions.value.filter((s) => s.id !== msg.session.id);
        if (currentId.value === msg.session.id) {
          currentId.value = undefined;
          items.value = [];
        }
      } else upsertSession(msg.session);
      break;
    case 'config':
      config.value = msg.config;
      applyLang();
      break;
    case 'error':
      if (msg.message) showToast(friendlyError(msg.message));
      break;
    case 'pong':
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

export async function connect(c: Connection): Promise<void> {
  connectError.value = undefined;
  const candidate = new Api(c);
  try {
    await Api.health(c.url);
  } catch {
    connectError.value = t(lang.value, 'connect.err.unreachable');
    throw new Error('unreachable');
  }
  try {
    const me = await candidate.me();
    config.value = me.config;
  } catch (err) {
    connectError.value =
      err instanceof ApiError && err.status === 401
        ? t(lang.value, 'connect.err.token')
        : t(lang.value, 'connect.err.unreachable');
    throw err;
  }
  saveConnection(c);
  conn.value = c;
  api = candidate;
  authed.value = true;
  applyLang();
  socket?.close();
  socket = new GatewaySocket(c, {
    onMessage: handleMessage,
    onStatus: (s) => (socketStatus.value = s),
  });
  socket.connect();
  void refreshSessions();
  void refreshModels();
}

export function disconnect(): void {
  socket?.close();
  socket = undefined;
  api = undefined;
  authed.value = false;
  conn.value = undefined;
  saveConnection(undefined);
  sessions.value = [];
  items.value = [];
  currentId.value = undefined;
  config.value = undefined;
}

export function wakeSocket(): void {
  socket?.wake();
}

export async function refreshSessions(): Promise<void> {
  if (!api) return;
  try {
    const r = await api.sessions(100);
    sessions.value = r.sessions;
    running.value = new Set(r.sessions.filter((s) => s.running).map((s) => s.id));
  } catch {
    /* offline */
  }
}

export async function refreshModels(): Promise<void> {
  if (!api) return;
  try {
    models.value = await api.models();
  } catch {
    /* ignore */
  }
}

/** Recover download links from stored tool output ("created /path/x.pdf (2 pages, …)"). */
export function filesFromToolText(text: string): FileRefDTO[] {
  const files: FileRefDTO[] = [];
  const main = /^(?:created|overwrote|appended to) (.+?) \(\d+ (?:lines?|pages?)\b/.exec(text);
  if (main?.[1]) files.push({ path: main[1], name: main[1].split(/[\\/]/).pop() ?? main[1] });
  const copy = /Downloads folder: (.+)$/m.exec(text);
  if (copy?.[1])
    files.push({ path: copy[1].trim(), name: copy[1].trim().split(/[\\/]/).pop() ?? copy[1] });
  return files;
}

function historyToItems(msgs: MessageDTO[]): Item[] {
  const out: Item[] = [];
  const tools = new Map<string, ToolItem>();
  for (const m of msgs) {
    if (m.role === 'user') out.push({ kind: 'user', id: m.id, text: m.text, ts: m.createdAt });
    else if (m.role === 'assistant') {
      if (m.text.trim()) {
        out.push({
          kind: 'assistant',
          id: m.id,
          text: signal(m.text),
          reasoning: signal(''),
          streaming: signal(false),
          ts: m.createdAt,
        });
      }
      for (const c of m.toolCalls ?? []) {
        let summary = c.name;
        try {
          const a = JSON.parse(c.arguments) as Record<string, unknown>;
          // Mirror the server-side summaries closely enough for history (no tool code in the UI).
          const action = typeof a.action === 'string' ? ` ${a.action}` : '';
          const target = c.name === 'memory' && typeof a.target === 'string' ? ` ${a.target}` : '';
          const v =
            a.command ?? a.path ?? a.url ?? a.query ?? a.pattern ?? a.name ?? a.text ?? a.sessionId;
          summary = `${c.name}${action}${target}${typeof v === 'string' ? `: ${v.slice(0, 80)}` : ''}`;
        } catch {
          /* keep name */
        }
        const tool: ToolItem = {
          kind: 'tool',
          id: c.id,
          name: c.name,
          summary,
          args: prettyJson(c.arguments),
          status: signal<ToolStatus>('done'),
          output: signal(''),
          progress: signal(''),
          ms: signal<number | undefined>(undefined),
          truncated: false,
          files: signal<FileRefDTO[]>([]),
        };
        tools.set(c.id, tool);
        out.push(tool);
      }
    } else if (m.role === 'tool' && m.toolCallId) {
      const tool = tools.get(m.toolCallId);
      if (tool) {
        tool.output.value = m.text;
        tool.files.value = filesFromToolText(m.text);
        if (/^error: the user declined/i.test(m.text)) tool.status.value = 'denied';
        else if (/^error: you already ran/i.test(m.text)) {
          tool.status.value = 'denied';
          tool.reason = 'repeat';
        } else if (/^error:/i.test(m.text)) tool.status.value = 'error';
      }
    }
  }
  return out;
}

export async function loadHistory(id: string): Promise<void> {
  if (!api) return;
  loadingHistory.value = true;
  try {
    const r = await api.messages(id);
    if (currentId.value !== id) return;
    currentAssistant = undefined;
    items.value = historyToItems(r.messages);
    upsertSession(r.session);
    if (r.session.running) newAssistant();
    for (const p of pending.value) {
      if (p.sessionId === id) push({ kind: 'approval', id: p.id, approval: signal(p) });
    }
  } catch (err) {
    showToast(friendlyError((err as Error).message));
  } finally {
    loadingHistory.value = false;
  }
}

export function openSession(id: string | undefined): void {
  currentId.value = id;
  items.value = [];
  currentAssistant = undefined;
  sidebarOpen.value = false;
  if (id) void loadHistory(id);
}

export function newChat(): void {
  openSession(undefined);
}

export function sendMessage(text: string): void {
  const trimmed = text.trim();
  if (!trimmed || !socket) return;
  if (isRunning.value) return;
  optimisticRef = `r${Date.now()}`;
  push({ kind: 'user', id: nid(), text: trimmed, ts: Date.now() });
  socket.send({
    type: 'send',
    sessionId: currentId.value,
    text: trimmed,
    clientRef: optimisticRef,
  });
}

export function cancelTurn(): void {
  if (currentId.value) socket?.send({ type: 'cancel', sessionId: currentId.value });
}

export function answerApproval(id: string, answer: ApprovalAnswer): void {
  socket?.send({ type: 'approve', id, answer });
}

export async function deleteSession(id: string): Promise<void> {
  if (!api) return;
  try {
    await api.deleteSession(id);
    sessions.value = sessions.value.filter((s) => s.id !== id);
    if (currentId.value === id) openSession(undefined);
  } catch (err) {
    showToast(friendlyError((err as Error).message));
  }
}

export async function undoLast(): Promise<void> {
  if (!api || !currentId.value || isRunning.value) return;
  try {
    await api.undo(currentId.value);
    await loadHistory(currentId.value);
  } catch (err) {
    showToast(friendlyError((err as Error).message));
  }
}

export async function setSessionModel(ref: string): Promise<void> {
  if (!api) return;
  try {
    if (currentId.value) {
      const r = await api.setSessionModel(currentId.value, ref);
      upsertSession(r.session);
    } else {
      // No session yet: create one with that model so the next message uses it.
      const r = await api.createSession({ model: ref });
      upsertSession(r.session);
      currentId.value = r.session.id;
    }
    showToast(`${t(lang.value, 'chat.model')}: ${ref}`);
  } catch (err) {
    showToast(friendlyError((err as Error).message));
  }
}

export async function saveConfig(patch: Record<string, unknown>): Promise<boolean> {
  if (!api) return false;
  try {
    const r = await api.setConfig(patch);
    config.value = r.config;
    applyLang();
    showToast(t(lang.value, 'settings.saved'));
    return true;
  } catch (err) {
    showToast(friendlyError((err as Error).message));
    return false;
  }
}

export function setLocalLang(l: Lang): void {
  localLang.value = l;
  localStorage.setItem(LANG_KEY, l);
  applyLang();
}

export function setTheme(mode: 'dark' | 'light' | 'system'): void {
  theme.value = mode;
  localStorage.setItem(THEME_KEY, mode);
  applyTheme();
}

export function setShowReasoning(on: boolean): void {
  showReasoning.value = on;
  localStorage.setItem(REASONING_KEY, on ? '1' : '0');
}
