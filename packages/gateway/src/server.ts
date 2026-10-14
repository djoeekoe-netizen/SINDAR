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
  MemoryFiles,
  MemoryError,
  SkillStore,
  SkillError,
  fetchGitHubSkills,
  installBundle,
  parseSkillSpec,
  scanSkillFiles,
  type AgentRuntime,
  type ApprovalMode,
  type Lang,
  type SkillMeta,
} from '@sindar/core';
import type {
  ApprovalAnswer,
  ClientMessage,
  HealthDTO,
  MemoryFileDTO,
  ModelsDTO,
  PublicConfigDTO,
  ServerMessage,
  SkillDTO,
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
  'skills.autoCreate',
  'memory.nudgeEvery',
]);

/** Extra types for files produced by tools (served by /api/files). */
const DOWNLOAD_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.html': 'text/plain; charset=utf-8',
  '.htm': 'text/plain; charset=utf-8',
  '.js': 'text/plain; charset=utf-8',
  '.mjs': 'text/plain; charset=utf-8',
  '.svg': 'text/plain; charset=utf-8',
};

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
    skillsMode: rt.config.skills.autoCreate,
    memoryNudgeEvery: rt.config.memory.nudgeEvery,
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
        case 'skills.autoCreate':
          rt.config.skills.autoCreate = value as PublicConfigDTO['skillsMode'];
          break;
        case 'memory.nudgeEvery':
          rt.config.memory.nudgeEvery = Number(value);
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

  // ---- memory (M3) ------------------------------------------------------
  const memoryFiles = () =>
    rt.memory ??
    new MemoryFiles(rt.paths, {
      memory: rt.config.memory.maxChars,
      user: rt.config.memory.userMaxChars,
    });
  const memoryDTO = (target: MemoryFileDTO['target']): MemoryFileDTO => {
    if (target === 'soul') {
      let content = '';
      try {
        content = fs.readFileSync(rt.paths.soul, 'utf8');
      } catch {
        /* missing */
      }
      return { target, content, chars: content.length, limit: 0, entries: 0, path: rt.paths.soul };
    }
    const mem = memoryFiles();
    const st = mem.stats(target);
    return {
      target,
      content: mem.read(target),
      chars: st.chars,
      limit: st.limit,
      entries: st.entries,
      path: mem.file(target),
    };
  };
  app.get('/api/memory', (c) =>
    c.json({ files: [memoryDTO('user'), memoryDTO('memory'), memoryDTO('soul')] }),
  );
  app.put('/api/memory/:target', async (c) => {
    const target = c.req.param('target') as MemoryFileDTO['target'];
    if (target !== 'memory' && target !== 'user' && target !== 'soul')
      return c.json({ error: 'target must be memory | user | soul' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { content?: unknown };
    if (typeof body.content !== 'string') return c.json({ error: 'content required' }, 400);
    try {
      if (target === 'soul') {
        if (body.content.length > 20_000)
          return c.json({ error: 'SOUL.md is limited to 20000 chars' }, 400);
        fs.writeFileSync(rt.paths.soul, body.content, { encoding: 'utf8', mode: 0o600 });
      } else {
        memoryFiles().write(target, body.content);
      }
    } catch (err) {
      return c.json({ error: (err as Error).message }, err instanceof MemoryError ? 400 : 500);
    }
    return c.json({ ok: true, file: memoryDTO(target) });
  });

  // ---- session search (M3) -----------------------------------------------
  app.get('/api/search', (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (!q) return c.json({ query: q, results: [] });
    const limit = Math.min(20, Math.max(1, Number(c.req.query('limit') ?? 10) || 10));
    const results = rt.store.search(q, { limit }).map((r) => ({
      session: toSessionDTO(r.session),
      hits: r.hits,
    }));
    return c.json({ query: q, results });
  });

  // ---- skills (M3) --------------------------------------------------------
  const skillStore = () =>
    rt.skills ?? new SkillStore({ user: rt.paths.skills, extra: rt.config.skills.extraDirs });
  const skillDTO = (s: SkillMeta): SkillDTO => ({
    name: s.name,
    description: s.description,
    version: s.version,
    tags: s.tags,
    source: s.source,
    chars: s.chars,
    updatedAt: s.updatedAt,
    origin: s.origin,
  });
  const skillError = (c: Context, err: unknown) => {
    const e = err as Error & { code?: string };
    const status = err instanceof SkillError ? (e.code === 'not-found' ? 404 : 400) : 500;
    return c.json({ error: e.message, code: e.code }, status);
  };
  // ---- files produced by tools (download / open) --------------------------
  app.get('/api/files', (c) => {
    const p = c.req.query('path') ?? '';
    if (!p || !path.isAbsolute(p)) return c.json({ error: 'absolute path required' }, 400);
    const abs = path.resolve(p);
    const secret = [rt.paths.env, rt.paths.db, `${rt.paths.db}-wal`, `${rt.paths.db}-shm`];
    if (
      secret.some((f) => path.resolve(f) === abs) ||
      abs.includes(`${path.sep}.ssh${path.sep}`) ||
      path.basename(abs) === 'gateway.token'
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return c.json({ error: 'not found' }, 404);
    }
    if (!st.isFile()) return c.json({ error: 'not a file' }, 404);
    if (st.size > 200 * 1024 * 1024) return c.json({ error: 'file too large' }, 413);
    const ext = path.extname(abs).toLowerCase();
    const mime = DOWNLOAD_MIME[ext] ?? MIME[ext] ?? 'application/octet-stream';
    const inlineOk = ext === '.pdf' || mime.startsWith('image/') || mime.startsWith('text/');
    const disposition = c.req.query('download') === '1' || !inlineOk ? 'attachment' : 'inline';
    const name = path.basename(abs);
    const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    return c.body(fs.readFileSync(abs), 200, {
      'content-type': mime,
      'content-length': String(st.size),
      'content-disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
  });

  app.get('/api/skills', (c) =>
    c.json({
      skills: skillStore().list().map(skillDTO),
      mode: rt.config.skills.autoCreate,
      dir: rt.paths.skills,
    }),
  );
  app.get('/api/skills/:name', (c) => {
    const s = skillStore().get(c.req.param('name'));
    if (!s) return c.json({ error: 'not found' }, 404);
    return c.json({
      skill: { ...skillDTO(s), body: s.body, raw: s.raw, files: s.files, path: s.file },
    });
  });
  app.post('/api/skills', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      body?: string;
      tags?: string[];
    };
    if (!body.name || !body.description || !body.body)
      return c.json({ error: 'name, description and body are required' }, 400);
    try {
      const s = skillStore().create({
        name: body.name,
        description: body.description,
        body: body.body,
        tags: body.tags,
      });
      return c.json({ skill: { ...skillDTO(s), body: s.body, files: s.files, path: s.file } }, 201);
    } catch (err) {
      return skillError(c, err);
    }
  });
  app.put('/api/skills/:name', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      description?: string;
      body?: string;
      tags?: string[];
      changelog?: string;
    };
    try {
      const s = skillStore().update(c.req.param('name'), body);
      return c.json({ skill: { ...skillDTO(s), body: s.body, files: s.files, path: s.file } });
    } catch (err) {
      return skillError(c, err);
    }
  });
  app.delete('/api/skills/:name', (c) => {
    try {
      skillStore().remove(c.req.param('name'));
      return c.json({ ok: true });
    } catch (err) {
      return skillError(c, err);
    }
  });
  app.post('/api/skills/install', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      source?: string;
      force?: boolean;
      overwrite?: boolean;
      dryRun?: boolean;
    };
    if (!body.source?.trim())
      return c.json({ error: 'source required (github:owner/repo/path)' }, 400);
    try {
      const spec = parseSkillSpec(body.source);
      const bundles = await fetchGitHubSkills(spec, {
        token: rt.env.GITHUB_TOKEN,
        signal: AbortSignal.timeout(30_000),
      });
      if (body.dryRun) {
        return c.json({
          preview: bundles.map((b) => ({
            name: b.name,
            origin: b.origin,
            files: b.files.map((f) => f.path),
            warnings: scanSkillFiles(b.files),
          })),
        });
      }
      const store = skillStore();
      const installed: Array<{ skill: SkillDTO; warnings: unknown[] }> = [];
      for (const b of bundles) {
        const r = installBundle(store, b, { force: body.force, overwrite: body.overwrite });
        installed.push({ skill: skillDTO(r.skill), warnings: r.warnings });
      }
      return c.json({ installed }, 201);
    } catch (err) {
      return skillError(c, err);
    }
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
