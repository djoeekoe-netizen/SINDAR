import type { ClientMessage, ServerMessage } from '../../../gateway/src/protocol.ts';
import type { Connection } from './api.ts';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface SocketHandlers {
  onMessage(msg: ServerMessage): void;
  onStatus(status: SocketStatus, attempt: number): void;
}

/** Auto-reconnecting WebSocket client with exponential backoff and app-level heartbeats. */
export class GatewaySocket {
  private ws: WebSocket | undefined;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
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

  connect(): void {
    this.closedByUser = false;
    this.clearTimers();
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
    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.handlers.onStatus('open', 0);
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 30_000);
    });
    ws.addEventListener('message', (ev) => {
      try {
        this.handlers.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.addEventListener('close', () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      if (this.ws === ws) this.ws = undefined;
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
    this.timer = setTimeout(() => this.connect(), delay);
  }

  /** Reconnect immediately (e.g. when the tab becomes visible again). */
  wake(): void {
    if (this.closedByUser || this.open) return;
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
    this.ws?.close();
    this.ws = undefined;
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = undefined;
    this.heartbeat = undefined;
  }
}
