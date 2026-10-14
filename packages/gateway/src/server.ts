import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  BUILD,
  VERSION,
  instantiateProvider,
  isChatModelId,
  resolveProviders,
  setConfigValue,
  getProviderTemplate,
  type AgentRuntime,
  type ApprovalMode,
  type Lang,
} from '@sindar/core';
import type {
  ApprovalAnswer,
  ClientMessage,
  HealthDTO,
  ModelsDTO,
  PublicConfigDTO,
  ServerMessage,
} from './protocol.js';
import { TurnManager, toMessageDTO, toSessionDTO } from './runner.js';
import { loadOrCreateToken } from './token.js';
import { acquireWakeLock, releaseWakeLock } from './wake-lock.js';

export const GATEWAY_DEFAULT_PORT = 18789;

export interface GatewayOptions {
  host?: string;
  port?: number;
  /** Explicit token (otherwise `~/.sindar/gateway.token`, created on first start). */
  token?: string;
  /** Directory with the built web UI (index.html + assets). Optional. */
  uiDir?: string;
  /** Acquire `termux-wake-lock` on Termux so Android keeps the brain alive. Default true. */
  wakeLock?: boolean;
}

export interface Gateway {
  host: string;
  port: number;
  url: string;
  token: string;
  manager: TurnManager;
  server: Server;
  /** Number of connected WebSocket clients. */
  clients(): number;
  close(): Promise<void>;
}

const CONFIG_KEYS = new Set([
  'ui.language',
  'ui.theme',
  'model.default',
  'model.fallbacks',
  'agent.approvalMode',
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function publicConfig(rt: AgentRuntime): PublicConfigDTO {
  return {
    language: rt.config.ui.language,
    theme: rt.config.ui.theme,
    model: { default: rt.config.model.default, fallbacks: [...rt.config.model.fallbacks] },
    approvalMode: rt.config.agent.approvalMode,
    workspace: rt.paths.workspace,
    home: rt.paths.home,
    platform: {
      os: rt.platform.os,
      isTermux: rt.platform.isTermux,
      arch: rt.platform.arch,
      nodeVersion: rt.platform.nodeVersion,
    },
    version: VERSION,
    build: BUILD,
  };
}

function modelsDTO(rt: AgentRuntime): ModelsDTO {
  const lang: Lang = rt.lang;
  return {
    default: rt.config.model.default,
    fallbacks: [...rt.config.model.fallbacks],
    providers: resolveProviders(rt.config, rt.env).map((p) => {
      const tpl = getProviderTemplate(p.id);
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        configured: p.configured,
        enabled: p.enabled,
        free: p.free,
        signupUrl: p.signupUrl,
        suggested: [...(tpl?.suggestedModels ?? [])],
        notes: tpl?.notes?.[lang],
      };
    }),
  };
}

export async function createGateway(rt: AgentRuntime, opts: GatewayOptions = {}): Promise<Gateway> {
  const host = opts.host ?? rt.config.gateway.host;
  const port = opts.port ?? rt.config.gateway.port;
  const token = opts.token ?? rt.env.SINDAR_GATEWAY_TOKEN ?? loadOrCreateToken(rt.paths.home);
  const manager = new TurnManager(rt);
  const startedAt = Date.now();
  const sockets = new Set<WebSocket>();
  const uiDir =
    opts.uiDir && fs.existsSync(path.join(opts.uiDir, 'index.html')) ? opts.uiDir : undefined;

  const app = new Hono();
  app.use('/api/*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'] }));

  // ---- auth -------------------------------------------------------------
  const tokenFrom = (c: Context): string | undefined => {
    const h = c.req.header('authorization');
    if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
    return c.req.query('token') ?? undefined;
  };
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const t = tokenFrom(c);
    if (!t || !safeEqual(t, token)) return c.json({ error: 'unauthorized' }, 401);
    return next();
  });

  // ---- health -----------------------------------------------------------
  app.get('/health', (c) => {
    const body: HealthDTO = {
      ok: true,
      name: 'sindar',
      version: VERSION,
      build: BUILD,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      model: rt.config.model.default,
      sessions: rt.store.list({ limit: 1000 }).length,
      running: manager.runningSessions().length,
      pending: manager.pendingApprovals().length,
      platform: { os: rt.platform.os, isTermux: rt.platform.isTermux },
    };
    return c.json(body);
  });

  // ---- me / config ------------------------------------------------------
  app.get('/api/me', (c) => c.json({ ok: true, config: publicConfig(rt) }));
  app.get('/api/config', (c) => c.json(publicConfig(rt)));
  app.put('/api/config', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const applied: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (!CONFIG_KEYS.has(key)) return c.json({ error: `key not allowed: ${key}` }, 400);
      try {
        setConfigValue(rt.paths.config, key, value);
      } catch (err) {
        return c.json({ error: (err as Error).message, key }, 400);
      }
      applied.push(key);
      switch (key) {
        case 'ui.language':
          rt.config.ui.language = value as Lang;
          rt.lang = value as Lang;
          break;
        case 'ui.theme':
          rt.config.ui.theme = value as PublicConfigDTO['theme'];
          break;
        case 'model.default':
          rt.config.model.default = value as string;
          break;
        case 'model.fallbacks':
          rt.config.model.fallbacks = value as string[];
          break;
        case 'agent.approvalMode':
          rt.config.agent.approvalMode = value as ApprovalMode;
          manager.setApprovalMode(value as ApprovalMode);
          break;
        default:
          break;
      }
    }
    const cfg = publicConfig(rt);
    broadcast({ type: 'config', config: cfg });
    return c.json({ ok: true, applied, config: cfg });
  });

  // ---- models -----------------------------------------------------------
  app.get('/api/models', (c) => c.json(modelsDTO(rt)));
  app.get('/api/models/:provider', async (c) => {
    const id = c.req.param('provider');
    const resolved = rt.registry.resolve(id);
    if (!resolved) return c.json({ error: 'unknown provider' }, 404);
    if (!resolved.configured) return c.json({ error: 'provider has no API key', models: [] }, 409);
    try {
      const models = (await instantiateProvider(resolved).listModels())
        .map((m) => m.id)
        .filter(isChatModelId)
        .toSorted();
      return c.json({ provider: id, models });
    } catch (err) {
      return c.json({ error: (err as Error).message, models: [] }, 502);
    }
  });

  // ---- sessions ---------------------------------------------------------
  app.get('/api/sessions', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 500);
    const list = rt.store.list({ limit }).map((s) => toSessionDTO(s, manager.isRunning(s.id)));
    return c.json({ sessions: list });
  });
  app.post('/api/sessions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { model?: string; cwd?: string };
    const s = manager.createSession({ model: body.model, cwd: body.cwd });
    return c.json({ session: manager.summary(s) }, 201);
  });
  app.get('/api/sessions/:id', (c) => {
    const s = rt.store.find(c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    return c.json({ session: manager.summary(s) });
  });
  app.get('/api/sessions/:id/messages', (c) => {
    const s = rt.store.find(c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    const afterSeq = Number(c.req.query('after') ?? 0) || 0;
    return c.json({
      session: manager.summary(s),
      messages: rt.store.messages(s.id, { afterSeq }).map(toMessageDTO),
      usage: rt.store.usage(s.id),
    });
  });
  app.delete('/api/sessions/:id', (c) => {
    const s = rt.store.find(c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    manager.deleteSession(s.id);
    return c.json({ ok: true });
  });
  app.put('/api/sessions/:id/model', async (c) => {
    const s = rt.store.find(c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { model?: string | null };
    if (body.model) {
      try {
        rt.registry.parse(body.model);
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
    }
    const updated = manager.updateSession(s.id, { model: body.model ?? null });
    return c.json({ session: manager.summary(updated!) });
  });
  app.post('/api/sessions/:id/messages', async (c) => {
    const s = rt.store.find(c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { text?: string; model?: string };
    if (!body.text?.trim()) return c.json({ error: 'text required' }, 400);
    try {
      const { turnId } = manager.send({ sessionId: s.id, text: body.text, model: body.model });
      return c.json({ ok: true, sessionId: s.id, turnId }, 202);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });
  app.post('/api/sessions/:id/cancel', (c) => {
    const s = rt.store.find(c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: manager.cancel(s.id) });
  });
  app.post('/api/sessions/:id/undo', (c) => {
    const s = rt.store.find(c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    if (manager.isRunning(s.id)) return c.json({ error: 'turn running' }, 409);
    const removed = rt.store.undoLastTurn(s.id);
    return c.json({ ok: removed !== undefined, removed: removed ?? null });
  });

  // ---- approvals --------------------------------------------------------
  app.get('/api/approvals', (c) => c.json({ pending: manager.pendingApprovals() }));
  app.post('/api/approvals/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { answer?: ApprovalAnswer };
    const answer = body.answer;
    if (answer !== 'allow' && answer !== 'always' && answer !== 'deny')
      return c.json({ error: 'answer must be allow | always | deny' }, 400);
    const ok = manager.answer(c.req.param('id'), answer);
    return ok ? c.json({ ok: true }) : c.json({ error: 'no such pending approval' }, 404);
  });

  // ---- status -----------------------------------------------------------
  app.get('/api/status', (c) =>
    c.json({
      running: manager.runningSessions(),
      pending: manager.pendingApprovals(),
      clients: sockets.size,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
    }),
  );

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    return serveUi(c);
  });

  // ---- static UI (SPA) --------------------------------------------------
  function serveUi(c: Context) {
    if (!uiDir) {
      return c.text(
        `SINDAR gateway ${VERSION} is running.\nThe web UI is not bundled in this build — use \`sindar chat\` or connect a client to /ws.\n`,
        200,
        { 'content-type': 'text/plain; charset=utf-8' },
      );
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.text('method not allowed', 405);
    let rel = decodeURIComponent(new URL(c.req.url).pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const abs = path.normalize(path.join(uiDir, rel));
    if (!abs.startsWith(path.normalize(uiDir + path.sep)) && abs !== path.normalize(uiDir)) {
      return c.text('forbidden', 403);
    }
    let file = abs;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // SPA fallback: unknown paths without a file extension render the app shell.
      if (path.extname(rel)) return c.text('not found', 404);
      file = path.join(uiDir, 'index.html');
    }
    const ext = path.extname(file).toLowerCase();
    const headers: Record<string, string> = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': rel.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    };
    if (file.endsWith('sw.js')) headers['service-worker-allowed'] = '/';
    return c.body(fs.readFileSync(file), 200, headers);
  }

  // ---- websocket --------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true });
  const sendTo = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  const unsubscribe = manager.subscribe(broadcast);

  wss.on('connection', (ws) => {
    sockets.add(ws);
    sendTo(ws, {
      type: 'hello',
      version: VERSION,
      build: BUILD,
      config: publicConfig(rt),
      pending: manager.pendingApprovals(),
      running: manager.runningSessions(),
    });
    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        sendTo(ws, { type: 'error', message: 'invalid JSON' });
        return;
      }
      try {
        switch (msg.type) {
          case 'ping':
            sendTo(ws, { type: 'pong' });
            break;
          case 'send':
            manager.send({
              sessionId: msg.sessionId,
              text: msg.text,
              model: msg.model,
              cwd: msg.cwd,
              clientRef: msg.clientRef,
            });
            break;
          case 'cancel':
            manager.cancel(msg.sessionId);
            break;
          case 'approve':
            if (!manager.answer(msg.id, msg.answer))
              sendTo(ws, { type: 'error', message: 'no such pending approval', ref: msg.id });
            break;
          case 'subscribe':
            // Broadcast model: nothing to do yet (kept for future per-session filtering).
            break;
          default:
            sendTo(ws, { type: 'error', message: `unknown message type` });
        }
      } catch (err) {
        const ref = (msg as { clientRef?: string }).clientRef;
        sendTo(ws, { type: 'error', message: (err as Error).message, ref });
      }
    });
    ws.on('close', () => sockets.delete(ws));
    ws.on('error', () => sockets.delete(ws));
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, hostname: host, port }, () => resolve(s as Server));
    (s as Server).once('error', reject);
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const t = url.searchParams.get('token') ?? '';
    const protoHeader = req.headers['sec-websocket-protocol'];
    const fromProto =
      typeof protoHeader === 'string'
        ? protoHeader
            .split(',')
            .map((s) => s.trim())
            .find((s) => s.startsWith('sindar-token.'))
            ?.slice('sindar-token.'.length)
        : undefined;
    const presented = t || fromProto || '';
    if (!presented || !safeEqual(presented, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  // Keep-alive pings so proxies and Android doze don't silently drop sockets.
  const pinger = setInterval(() => {
    for (const ws of sockets) {
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 25_000);
  pinger.unref();

  if (opts.wakeLock !== false && rt.platform.isTermux) acquireWakeLock(rt.logger);

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${actualPort}`;
  rt.logger.info('gateway listening', { url, host, port: actualPort, ui: Boolean(uiDir) });

  return {
    host,
    port: actualPort,
    url,
    token,
    manager,
    server,
    clients: () => sockets.size,
    async close() {
      clearInterval(pinger);
      unsubscribe();
      await manager.shutdown();
      for (const ws of sockets) ws.close(1001, 'gateway shutting down');
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (opts.wakeLock !== false && rt.platform.isTermux) releaseWakeLock(rt.logger);
    },
  };
}
