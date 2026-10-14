import type { ClientMessage, ServerMessage } from '../../../gateway/src/protocol.ts';
import type { Connection } from './api.ts';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface SocketHandlers {
  onMessage(msg: ServerMessage): void;
  onStatus(status: SocketStatus, attempt: number): void;
}

/** Give up on a handshake that hangs (flaky mobile networks) and try again. */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * Auto-reconnecting WebSocket client with exponential backoff and app-level heartbeats.
 *
 * Invariant: at most ONE socket is alive at any time. The gateway broadcasts every event to
 * all connected sockets, so a stray second connection (e.g. `wake()` firing from both the
 * `online` and `visibilitychange` events while the first handshake is still in flight) would
 * make the UI render every message twice.
 */
export class GatewaySocket {
  private ws: WebSocket | undefined;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private closedByUser = false;
  private queue: ClientMessage[] = [];

  constructor(
    private readonly conn: Connection,
    private readonly handlers: SocketHandlers,
  ) {}

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** True while a socket is open or still shaking hands. */
  get alive(): boolean {
    const s = this.ws?.readyState;
    return s === WebSocket.OPEN || s === WebSocket.CONNECTING;
  }

  connect(): void {
    this.closedByUser = false;
    if (this.alive) return;
    this.clearTimers();
    this.dropSocket();
    const wsUrl = `${this.conn.url.replace(/^http/i, 'ws')}/ws?token=${encodeURIComponent(this.conn.token)}`;
    this.handlers.onStatus('connecting', this.attempt);
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.handshake = setTimeout(() => {
      if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) ws.close();
    }, HANDSHAKE_TIMEOUT_MS);
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.clearHandshake();
      this.attempt = 0;
      this.handlers.onStatus('open', 0);
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 30_000);
    });
    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws) return; // a socket we already replaced
      try {
        this.handlers.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.clearHandshake();
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      this.ws = undefined;
      this.handlers.onStatus('closed', this.attempt);
      if (!this.closedByUser) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      /* close follows */
    });
  }

  private scheduleReconnect(): void {
    this.attempt++;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.attempt, 5));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  /** Reconnect now (tab became visible / network came back) — unless a socket is already alive. */
  wake(): void {
    if (this.closedByUser || this.alive) return;
    this.clearTimers();
    this.connect();
  }

  send(msg: ClientMessage): void {
    if (this.open) this.ws!.send(JSON.stringify(msg));
    else if (msg.type !== 'ping') this.queue.push(msg);
  }

  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.dropSocket();
  }

  /** Detach and close the current socket (if any) without triggering a reconnect. */
  private dropSocket(): void {
    const ws = this.ws;
    this.ws = undefined;
    if (!ws) return;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  private clearHandshake(): void {
    if (this.handshake) clearTimeout(this.handshake);
    this.handshake = undefined;
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.clearHandshake();
    this.timer = undefined;
    this.heartbeat = undefined;
  }
}
