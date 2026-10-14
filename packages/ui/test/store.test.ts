/**
 * Store + socket regression tests (run in plain Node with a tiny browser shim).
 *
 * Phone bug these guard against: coming back to the PWA fired `online` + `visibilitychange`
 * while a reconnect was still shaking hands, a second WebSocket was opened, and every
 * broadcast frame was rendered twice → doubled text, stray bubbles, a stuck "…" bubble.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerMessage } from '../../gateway/src/protocol.ts';

// ---- minimal browser shim (must exist before the store module is imported) -------------
const storage = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};
const noop = () => undefined;
const docEl = { dataset: {} as Record<string, string>, lang: '', dir: '' };
Object.assign(globalThis, {
  localStorage: fakeStorage,
  document: { documentElement: docEl, querySelector: () => null, addEventListener: noop },
  window: {
    matchMedia: () => ({ matches: true, addEventListener: noop, removeEventListener: noop }),
    addEventListener: noop,
    removeEventListener: noop,
  },
  location: {
    origin: 'http://gw.test',
    host: 'gw.test',
    search: '',
    hash: '',
    pathname: '/',
    reload: noop,
  },
});

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Array<(ev: unknown) => void>>();
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  private fire(type: string, ev: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.fire('open');
  }
  receive(msg: ServerMessage) {
    this.fire('message', { data: JSON.stringify(msg) });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.fire('close');
  }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket });

const publicConfig = {
  language: 'ar',
  model: { default: 'mock:echo', fallbacks: [] },
  approvalMode: 'ask',
  workspace: '/w',
  home: '/h',
  platform: { os: 'linux', isTermux: false, arch: 'x64', nodeVersion: 'v22' },
  version: '0.1.0',
  build: 'test',
} as const;

const jsonRes = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

Object.assign(globalThis, {
  fetch: async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/health')) return jsonRes({ ok: true });
    if (url.endsWith('/api/me')) return jsonRes({ ok: true, config: publicConfig });
    if (url.includes('/api/sessions')) return jsonRes({ sessions: [] });
    if (url.includes('/api/models'))
      return jsonRes({ default: 'mock:echo', fallbacks: [], providers: [] });
    return new Response('{}', { status: 404 });
  },
});

type Store = typeof import('../src/lib/store.ts');
let store: Store;

const session = {
  id: 's1',
  title: null,
  channel: 'web',
  model: null,
  cwd: null,
  approvalMode: null,
  createdAt: 1,
  updatedAt: 1,
};

const T = 'ما هو المشروع أو المهمة التي تريد أن أساعدك فيها الآن؟';

/** The frames the gateway broadcasts for one simple answer, split in small deltas. */
function turnFrames(turnId: string, clientRef: string | undefined, text = T): ServerMessage[] {
  const frames: ServerMessage[] = [
    {
      type: 'turn_start',
      sessionId: 's1',
      turnId,
      session,
      model: 'mock:echo',
      clientRef,
      text: 'على ماذا أعمل؟',
    },
  ];
  let seq = 0;
  frames.push({
    type: 'event',
    sessionId: 's1',
    turnId,
    seq: ++seq,
    event: { type: 'reasoning', delta: 'hmm' },
  });
  for (let i = 0; i < text.length; i += 7) {
    frames.push({
      type: 'event',
      sessionId: 's1',
      turnId,
      seq: ++seq,
      event: { type: 'text', delta: text.slice(i, i + 7) },
    });
  }
  frames.push({
    type: 'event',
    sessionId: 's1',
    turnId,
    seq: ++seq,
    event: { type: 'done', finishReason: 'stop', text, iterations: 1 },
  });
  frames.push({ type: 'turn_end', sessionId: 's1', turnId, ok: true, finishReason: 'stop', text });
  return frames;
}

const textOf = (x: { kind: string; text?: { value: string } | string }) =>
  typeof x.text === 'string' ? x.text : (x.text?.value ?? '');

describe('web UI store', () => {
  beforeAll(async () => {
    store = await import('../src/lib/store.ts');
    await store.connect({ url: 'http://gw.test', token: 'tok' });
    // Simulate the first socket completing its handshake.
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.receive({
      type: 'hello',
      version: '0.1.0',
      build: 'test',
      config: publicConfig,
      pending: [],
      running: [],
    });
  });

  it('keeps a single live socket when wake() fires during a handshake', () => {
    const first = FakeWebSocket.instances[0]!;
    first.close(); // network blip → reconnect scheduled
    store.wakeSocket(); // `online` → connects right away (CONNECTING)
    const count = FakeWebSocket.instances.length;
    store.wakeSocket(); // `visibilitychange` a moment later must NOT open another one
    store.wakeSocket();
    expect(FakeWebSocket.instances.length).toBe(count);
    const sock = FakeWebSocket.instances.at(-1)!;
    expect(sock.readyState).toBe(FakeWebSocket.CONNECTING);
    sock.open();
    store.wakeSocket();
    expect(FakeWebSocket.instances.length).toBe(count);
    expect(store.socketStatus.value).toBe('open');
  });

  it('renders a streamed answer once even when every frame arrives twice', () => {
    const sock = FakeWebSocket.instances.at(-1)!;
    store.newChat();
    store.sendMessage('على ماذا أعمل؟');
    const sent = JSON.parse(sock.sent.at(-1)!) as { type: string; clientRef: string };
    expect(sent.type).toBe('send');

    // Two sockets would deliver the same frames in some interleaving; emulate the worst case
    // (whole turn twice, plus a lagging copy of part of the stream).
    const frames = turnFrames('t1', sent.clientRef);
    const lag = frames.slice(0, 5);
    for (const f of [...lag, ...frames, ...frames]) sock.receive(f);

    const items = store.items.value;
    const users = items.filter((x) => x.kind === 'user');
    const assistants = items.filter((x) => x.kind === 'assistant');
    expect(users.length).toBe(1);
    expect(assistants.length).toBe(1);
    expect(textOf(assistants[0]!)).toBe(T);
    expect((assistants[0] as { streaming: { value: boolean } }).streaming.value).toBe(false);
    expect(store.isRunning.value).toBe(false);
  });

  it('snaps the bubble to the final text when deltas were lost and never leaves "…" spinning', () => {
    const sock = FakeWebSocket.instances.at(-1)!;
    store.sendMessage('ثانية');
    const sent = JSON.parse(sock.sent.at(-1)!) as { clientRef: string };
    const frames = turnFrames('t2', sent.clientRef, 'نص كامل من الخادم');
    // Drop a delta in the middle (phone lost a frame while backgrounded).
    const lossy = frames.filter((f) => !(f.type === 'event' && f.seq === 3));
    for (const f of lossy) sock.receive(f);
    const assistants = store.items.value.filter((x) => x.kind === 'assistant');
    expect(textOf(assistants.at(-1)!)).toBe('نص كامل من الخادم');

    // A turn that starts while an older bubble is still streaming must finish that bubble first.
    store.sendMessage('ثالثة');
    const ref3 = (JSON.parse(sock.sent.at(-1)!) as { clientRef: string }).clientRef;
    const t3 = turnFrames('t3', ref3, 'أ');
    sock.receive(t3[0]!); // turn_start → bubble A ("…")
    store.sendMessage('رابعة'); // (gateway would refuse, but a stale UI may still try)
    const ref4 = (JSON.parse(sock.sent.at(-1)!) as { clientRef: string }).clientRef;
    const t4 = turnFrames('t4', ref4, 'ب');
    for (const f of t4) sock.receive(f);
    const spinning = store.items.value.filter(
      (x) => x.kind === 'assistant' && (x as { streaming: { value: boolean } }).streaming.value,
    );
    expect(spinning.length).toBe(0);
  });
});
