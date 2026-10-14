import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {
  createLogger,
  detectPlatform,
  ensureIdentityFiles,
  loadConfig,
  openDatabase,
  ProviderRegistry,
  SessionStore,
  toolsForToolsets,
  type AgentRuntime,
} from '@sindar/core';
import { createGateway, type Gateway, type ServerMessage } from '../src/index.js';

async function makeRuntime(): Promise<AgentRuntime & { cleanup(): Promise<void> }> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-gw-'));
  const loaded = await loadConfig({ home, env: {}, init: true });
  const { config, paths } = loaded;
  ensureIdentityFiles(paths);
  const { db } = await openDatabase(paths.db, { driver: 'auto' });
  const rt = {
    config,
    paths,
    platform: detectPlatform({}),
    env: {},
    lang: 'en' as const,
    logger: createLogger({ level: 'error', console: false }),
    registry: new ProviderRegistry(config, {}),
    tools: toolsForToolsets(config.agent.toolsets),
    store: new SessionStore(db),
    cleanup: async () => {
      await db.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
  return rt;
}

function collect(ws: WebSocket): {
  msgs: ServerMessage[];
  waitFor: (pred: (m: ServerMessage) => boolean, ms?: number) => Promise<ServerMessage>;
} {
  const msgs: ServerMessage[] = [];
  const waiters: Array<{
    pred: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
  }> = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as ServerMessage;
    msgs.push(m);
    const hits = waiters.filter((w) => w.pred(m));
    for (const w of hits) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    }
  });
  return {
    msgs,
    waitFor: (pred, ms = 5000) =>
      new Promise((resolve, reject) => {
        const hit = msgs.find(pred);
        if (hit) return resolve(hit);
        const timer = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
        waiters.push({
          pred,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      }),
  };
}

const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

describe('gateway (mock provider)', () => {
  let rt: Awaited<ReturnType<typeof makeRuntime>>;
  let gw: Gateway;
  let uiDir: string;
  const api = (p: string, init: RequestInit = {}) =>
    fetch(`${gw.url}${p}`, {
      ...init,
      headers: {
        authorization: `Bearer ${gw.token}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });

  beforeAll(async () => {
    rt = await makeRuntime();
    uiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sindar-ui-'));
    fs.writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><title>SINDAR</title>');
    fs.mkdirSync(path.join(uiDir, 'assets'));
    fs.writeFileSync(path.join(uiDir, 'assets', 'app.js'), 'console.log(1)');
    gw = await createGateway(rt, { host: '127.0.0.1', port: 0, uiDir, wakeLock: false });
  });
  afterAll(async () => {
    await gw.close();
    await rt.cleanup();
    fs.rmSync(uiDir, { recursive: true, force: true });
  });

  it('serves health without a token and the UI shell with SPA fallback', async () => {
    const h = await json(fetch(`${gw.url}/health`));
    expect(h.ok).toBe(true);
    expect(h.name).toBe('sindar');
    const index = await fetch(`${gw.url}/`);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toContain('SINDAR');
    const deep = await fetch(`${gw.url}/sessions/abc`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('SINDAR');
    const asset = await fetch(`${gw.url}/assets/app.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${gw.url}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${gw.url}/..%2F..%2Fetc%2Fpasswd`)).status).not.toBe(200);
  });

  it('rejects API calls and sockets without the token', async () => {
    expect((await fetch(`${gw.url}/api/sessions`)).status).toBe(401);
    expect((await fetch(`${gw.url}/api/sessions?token=wrong`)).status).toBe(401);
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${gw.url.replace('http', 'ws')}/ws?token=nope`);
        ws.on('open', () => resolve('open'));
        ws.on('error', reject);
      }),
    ).rejects.toThrow();
  });

  it('runs a turn over the websocket and persists the session', async () => {
    const ws = new WebSocket(`${gw.url.replace('http', 'ws')}/ws?token=${gw.token}`);
    const { msgs: frames, waitFor } = collect(ws);
    await new Promise((r) => ws.on('open', r));
    const hello = await waitFor((m) => m.type === 'hello');
    expect(hello.type === 'hello' && hello.config.language).toBe('ar');

    ws.send(JSON.stringify({ type: 'send', text: 'hello gateway', clientRef: 'c1' }));
    const start = await waitFor((m) => m.type === 'turn_start');
    expect(start.type === 'turn_start' && start.clientRef).toBe('c1');
    const sessionId = start.type === 'turn_start' ? start.sessionId : '';
    const end = await waitFor((m) => m.type === 'turn_end');
    expect(end.type === 'turn_end' && end.ok).toBe(true);
    expect(end.type === 'turn_end' && end.text).toBe('echo: hello gateway');
    // Every event of a turn is numbered so clients can drop duplicates after a reconnect.
    const seqs = frames
      .filter((m) => m.type === 'event' && m.sessionId === sessionId)
      .map((m) => (m.type === 'event' ? m.seq : undefined));
    expect(seqs.length).toBeGreaterThan(1);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));

    const list = await json(api('/api/sessions'));
    expect(list.sessions[0].id).toBe(sessionId);
    expect(list.sessions[0].lastMessage).toBe('echo: hello gateway');
    const msgs = await json(api(`/api/sessions/${sessionId}/messages`));
    expect(msgs.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    ws.close();
  });

  it('asks for approval, lets a REST client answer, and reports the tool run', async () => {
    const ws = new WebSocket(`${gw.url.replace('http', 'ws')}/ws?token=${gw.token}`);
    const { waitFor } = collect(ws);
    await new Promise((r) => ws.on('open', r));
    await waitFor((m) => m.type === 'hello');
    ws.send(
      JSON.stringify({ type: 'send', text: '!tool terminal {"command":"echo hi-from-tool"}' }),
    );
    const approval = await waitFor((m) => m.type === 'approval');
    expect(approval.type === 'approval' && approval.approval.tool).toBe('terminal');
    const pending = await json(api('/api/approvals'));
    expect(pending.pending.length).toBe(1);
    const id = approval.type === 'approval' ? approval.approval.id : '';
    const res = await api(`/api/approvals/${id}`, {
      method: 'POST',
      body: JSON.stringify({ answer: 'allow' }),
    });
    expect(res.status).toBe(200);
    await waitFor((m) => m.type === 'approval_resolved');
    const toolEnd = await waitFor((m) => m.type === 'event' && m.event.type === 'tool_end');
    expect(
      toolEnd.type === 'event' && toolEnd.event.type === 'tool_end' && toolEnd.event.content,
    ).toContain('hi-from-tool');
    const end = await waitFor((m) => m.type === 'turn_end');
    expect(end.type === 'turn_end' && end.ok).toBe(true);
    ws.close();
  });

  it('denies via websocket and cancels running turns', async () => {
    const ws = new WebSocket(`${gw.url.replace('http', 'ws')}/ws?token=${gw.token}`);
    const { waitFor } = collect(ws);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'send', text: '!tool terminal {"command":"echo nope"}' }));
    const approval = await waitFor((m) => m.type === 'approval');
    const id = approval.type === 'approval' ? approval.approval.id : '';
    ws.send(JSON.stringify({ type: 'approve', id, answer: 'deny' }));
    const denied = await waitFor((m) => m.type === 'event' && m.event.type === 'tool_denied');
    expect(denied.type).toBe('event');
    await waitFor((m) => m.type === 'turn_end');

    // cancel: start a turn that waits on approval, then cancel the session
    ws.send(JSON.stringify({ type: 'send', text: '!tool terminal {"command":"echo later"}' }));
    const start = await waitFor(
      (m) => m.type === 'turn_start' && m.text === '!tool terminal {"command":"echo later"}',
    );
    const sid = start.type === 'turn_start' ? start.sessionId : '';
    await waitFor((m) => m.type === 'approval' && m.approval.sessionId === sid);
    const r = await api(`/api/sessions/${sid}/cancel`, { method: 'POST' });
    expect((await json(r)).ok).toBe(true);
    const end = await waitFor((m) => m.type === 'turn_end' && m.sessionId === sid);
    expect(end.type === 'turn_end' && (end.finishReason === 'cancelled' || end.ok)).toBeTruthy();
    ws.close();
  });

  it('exposes config, models and session management over REST', async () => {
    const cfg = await json(api('/api/config'));
    expect(cfg.model.default).toBe('mock:echo');
    const put = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ 'ui.language': 'en', 'agent.approvalMode': 'yolo' }),
    });
    expect(put.status).toBe(200);
    expect((await json(put)).config.language).toBe('en');
    const bad = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ 'providers.groq.apiKey': 'x' }),
    });
    expect(bad.status).toBe(400);
    const models = await json(api('/api/models'));
    expect(models.providers.find((p: { id: string }) => p.id === 'groq')).toBeTruthy();
    const created = await json(
      api('/api/sessions', { method: 'POST', body: JSON.stringify({ model: 'mock:echo' }) }),
    );
    expect(created.session.channel).toBe('web');
    const setModel = await api(`/api/sessions/${created.session.id}/model`, {
      method: 'PUT',
      body: JSON.stringify({ model: 'nonsense' }),
    });
    expect(setModel.status).toBe(400);
    const del = await api(`/api/sessions/${created.session.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    // restore for other tests
    await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ 'ui.language': 'ar', 'agent.approvalMode': 'ask' }),
    });
  });

  it('exposes memory files, session search and skills over REST (M3)', async () => {
    // memory
    const mem = await json(api('/api/memory'));
    expect(mem.files.map((f: { target: string }) => f.target)).toEqual(['user', 'memory', 'soul']);
    const user = mem.files[0];
    const put = await api('/api/memory/user', {
      method: 'PUT',
      body: JSON.stringify({ content: `${user.content}- يفضّل الردود المختصرة\n` }),
    });
    expect(put.status).toBe(200);
    expect((await json(put)).file.entries).toBe(user.entries + 1);
    expect(fs.readFileSync(rt.paths.user, 'utf8')).toContain('يفضّل الردود المختصرة');
    const tooBig = await api('/api/memory/memory', {
      method: 'PUT',
      body: JSON.stringify({ content: 'x'.repeat(rt.config.memory.maxChars + 1) }),
    });
    expect(tooBig.status).toBe(400);
    expect((await api('/api/memory/nope', { method: 'PUT', body: '{"content":""}' })).status).toBe(
      400,
    );
    // the config exposes the learning-loop knobs
    const cfg = await json(api('/api/config'));
    expect(cfg.skillsMode).toBe('ask');
    expect(cfg.memoryNudgeEvery).toBe(8);
    const modeRes = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ 'skills.autoCreate': 'auto' }),
    });
    expect((await json(modeRes)).config.skillsMode).toBe('auto');
    expect(rt.config.skills.autoCreate).toBe('auto');
    await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ 'skills.autoCreate': 'ask' }),
    });

    // search
    const s = rt.store.create({ channel: 'web', title: 'تقرير' });
    rt.store.append(s.id, { role: 'user', content: 'اكتب تقرير المبيعات لشهر سبتمبر' });
    rt.store.append(s.id, { role: 'assistant', content: 'done: reports/sales.md' });
    const found = await json(api(`/api/search?q=${encodeURIComponent('تقرير المبيعات')}`));
    expect(found.results).toHaveLength(1);
    expect(found.results[0].session.id).toBe(s.id);
    expect(found.results[0].hits[0].snippet).toContain('المبيعات');
    expect((await json(api('/api/search?q='))).results).toEqual([]);

    // skills
    const list = await json(api('/api/skills'));
    expect(list.mode).toBe('ask');
    expect(list.skills.some((k: { name: string }) => k.name === 'git-workflow')).toBe(true);
    const created = await api('/api/skills', {
      method: 'POST',
      body: JSON.stringify({
        name: 'weekly-report',
        description: 'Weekly report',
        body: '## Steps\n1. go',
      }),
    });
    expect(created.status).toBe(201);
    const one = await json(api('/api/skills/weekly-report'));
    expect(one.skill.body).toContain('1. go');
    expect(one.skill.source).toBe('user');
    const upd = await json(
      api('/api/skills/weekly-report', {
        method: 'PUT',
        body: JSON.stringify({ changelog: 'tweak', body: '## Steps\n1. go faster' }),
      }),
    );
    expect(upd.skill.version).toBe('1.0.1');
    expect(
      (
        await api('/api/skills', {
          method: 'POST',
          body: JSON.stringify({ name: 'bad name', description: 'd', body: 'b' }),
        })
      ).status,
    ).toBe(400);
    expect((await api('/api/skills/weekly-report', { method: 'DELETE' })).status).toBe(200);
    expect((await api('/api/skills/weekly-report')).status).toBe(404);
    expect((await api('/api/skills/nope', { method: 'DELETE' })).status).toBe(404);
    const install = await api('/api/skills/install', {
      method: 'POST',
      body: JSON.stringify({ source: 'nonsense' }),
    });
    expect(install.status).toBe(400);
    expect((await json(install)).error).toMatch(/expected github:/);
  });
});
