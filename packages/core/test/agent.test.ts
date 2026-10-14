import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeRuntime, policy } from './helpers.js';
import { runTurn, AgentError, type AgentEvent, type ApprovalRequest } from '../src/agent/loop.js';
import {
  buildSystemPrompt,
  ensureIdentityFiles,
  estimateTokens,
  findProjectContext,
} from '../src/agent/context.js';
import { createMockProvider } from '../src/providers/mock.js';

const collect = () => {
  const events: AgentEvent[] = [];
  return { events, onEvent: (e: AgentEvent) => events.push(e) };
};

describe('agent loop (mock provider)', () => {
  it('streams a plain reply and persists the session', async () => {
    const rt = await makeRuntime();
    try {
      const session = rt.store.create({ channel: 'cli', cwd: rt.paths.workspace });
      const { events, onEvent } = collect();
      const res = await runTurn(rt, { session, input: 'hello there', policy: policy(), onEvent });
      expect(res.text).toBe('echo: hello there');
      expect(res.finishReason).toBe('stop');
      expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(0);
      const msgs = rt.store.messages(session.id);
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(rt.store.get(session.id)?.title).toBe('hello there');
      expect(rt.store.get(session.id)?.model).toBe('mock:echo');
      expect(rt.store.usage(session.id)[0]?.calls).toBe(1);
      const again = await runTurn(rt, { session, input: 'second', policy: policy() });
      expect(again.text).toBe('echo: second');
      expect(rt.store.count(session.id)).toBe(4);
    } finally {
      await rt.cleanup();
    }
  });

  it('executes tool calls, feeds results back, and respects approvals', async () => {
    const rt = await makeRuntime();
    try {
      fs.writeFileSync(path.join(rt.paths.workspace, 'f.txt'), 'content-123');
      const session = rt.store.create({ channel: 'cli', cwd: rt.paths.workspace });
      const { events, onEvent } = collect();
      const res = await runTurn(rt, {
        session,
        input: '!tool read_file {"path":"f.txt"}',
        policy: policy(),
        onEvent,
      });
      expect(res.toolCalls).toBe(1);
      expect(res.iterations).toBe(2);
      expect(res.text).toMatch(/^tool-result:read_file:1│content-123/);
      const roles = rt.store.messages(session.id).map((m) => m.role);
      expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
      expect(events.some((e) => e.type === 'tool_start')).toBe(true);
      expect(events.some((e) => e.type === 'tool_end')).toBe(true);

      // exec requires approval in ask mode → deny
      const asked: ApprovalRequest[] = [];
      const denied = await runTurn(rt, {
        session,
        input: '!tool terminal {"command":"echo should-not-run"}',
        policy: policy(),
        requestApproval: async (req) => {
          asked.push(req);
          return 'deny';
        },
      });
      expect(asked).toHaveLength(1);
      expect(asked[0]!.decision.action).toBe('ask');
      expect(denied.text).toContain('tool-result:terminal:error: the user declined');

      // approve "always" → second call in same session is automatic
      const pol = policy();
      let prompts = 0;
      const allowed = await runTurn(rt, {
        session,
        input: '!tool terminal {"command":"echo ran-ok"}',
        policy: pol,
        requestApproval: async () => (prompts++, 'always'),
      });
      expect(allowed.text).toContain('ran-ok');
      const second = await runTurn(rt, {
        session,
        input: '!tool terminal {"command":"echo twice"}',
        policy: pol,
        requestApproval: async () => (prompts++, 'deny'),
      });
      expect(prompts).toBe(1);
      expect(second.text).toContain('twice');
      expect(pol.sessionAllowed.has('terminal:echo')).toBe(true);
    } finally {
      await rt.cleanup();
    }
  });

  it('never runs forbidden commands even in yolo mode and reports bad tool arguments', async () => {
    const rt = await makeRuntime();
    try {
      const session = rt.store.create({ channel: 'cli', cwd: rt.paths.workspace });
      const { events, onEvent } = collect();
      const res = await runTurn(rt, {
        session,
        input: '!tool terminal {"command":"rm -rf /"}',
        policy: policy('yolo'),
        onEvent,
      });
      expect(res.text).toContain('forbidden');
      expect(events.some((e) => e.type === 'tool_denied')).toBe(true);
      const bad = await runTurn(rt, {
        session,
        input: '!tool read_file {"nope":true}',
        policy: policy('yolo'),
      });
      expect(bad.text).toContain('invalid arguments for read_file');
      const unknown = await runTurn(rt, {
        session,
        input: '!tool teleport {}',
        policy: policy('yolo'),
      });
      expect(unknown.text).toContain('unknown tool');
    } finally {
      await rt.cleanup();
    }
  });

  it('waits for the network before switching models on connection failures', async () => {
    const offline = createMockProvider({
      script: [{ error: { message: 'fetch failed (UND_ERR_CONNECT_TIMEOUT)', code: 'network' } }],
    });
    const rt = await makeRuntime(
      {
        model: { default: 'offline:m1', fallbacks: ['mock:echo'] },
        providers: { offline: { type: 'mock' }, mock: {} },
      },
      { instances: { offline } },
    );
    try {
      const session = rt.store.create({ channel: 'cli' });
      const ac = new AbortController();
      const events: AgentEvent[] = [];
      const onEvent = (e: AgentEvent) => {
        events.push(e);
        if (e.type === 'retry_wait') ac.abort(); // don't actually sleep 5 s in the test
      };
      const res = await runTurn(rt, {
        session,
        input: 'hi',
        policy: policy(),
        onEvent,
        signal: ac.signal,
      });
      expect(res.finishReason).toBe('cancelled');
      const first = events.find((e) => e.type === 'retry_wait' || e.type === 'model_switch');
      expect(first).toMatchObject({ type: 'retry_wait', model: 'offline:m1', seconds: 5 });
      expect(events.some((e) => e.type === 'model_switch')).toBe(false);
    } finally {
      await rt.cleanup();
    }
  });

  it('falls back to the next model on retryable errors and surfaces auth errors', async () => {
    const flaky = createMockProvider({
      script: [{ error: { message: 'busy', code: 'rate_limit' } }],
    });
    const rt = await makeRuntime(
      {
        model: { default: 'flaky:m1', fallbacks: ['mock:echo'] },
        providers: { flaky: { type: 'mock' }, mock: {} },
      },
      { instances: { flaky } },
    );
    try {
      const session = rt.store.create({ channel: 'cli' });
      const { events, onEvent } = collect();
      const res = await runTurn(rt, { session, input: 'hi', policy: policy(), onEvent });
      expect(res.text).toBe('echo: hi');
      expect(res.model).toBe('mock:echo');
      expect(events.find((e) => e.type === 'model_switch')).toMatchObject({
        from: 'flaky:m1',
        to: 'mock:echo',
      });

      const rt2 = await makeRuntime({ model: { default: 'groq:llama', fallbacks: [] } });
      try {
        const s2 = rt2.store.create({ channel: 'cli' });
        await expect(runTurn(rt2, { session: s2, input: 'hi', policy: policy() })).rejects.toThrow(
          AgentError,
        );
        await expect(runTurn(rt2, { session: s2, input: 'hi', policy: policy() })).rejects.toThrow(
          /no API key/,
        );
      } finally {
        await rt2.cleanup();
      }
    } finally {
      await rt.cleanup();
    }
  });

  it('stops cleanly on cancellation and enforces maxIterations', async () => {
    const slow = createMockProvider({ chunkSize: 1, delayMs: 20 });
    const rt = await makeRuntime(
      {
        model: { default: 'slow:x' },
        providers: { slow: { type: 'mock' } },
        agent: { maxIterations: 2 },
      },
      { instances: { slow } },
    );
    try {
      const session = rt.store.create({ channel: 'cli' });
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 60);
      const res = await runTurn(rt, {
        session,
        input: 'a fairly long message to stream slowly',
        policy: policy(),
        signal: ac.signal,
      });
      expect(res.finishReason).toBe('cancelled');
      expect(res.text.length).toBeGreaterThan(0);
      expect(res.text.length).toBeLessThan('echo: a fairly long message to stream slowly'.length);

      // tool loop that never ends → capped by maxIterations
      const looping = createMockProvider({
        script: [
          { toolCalls: [{ id: 'c1', name: 'list_dir', arguments: '{}' }] },
          { toolCalls: [{ id: 'c2', name: 'list_dir', arguments: '{}' }] },
          { text: 'never' },
        ],
      });
      const rt2 = await makeRuntime(
        {
          model: { default: 'loop:x' },
          providers: { loop: { type: 'mock' } },
          agent: { maxIterations: 2 },
        },
        { instances: { loop: looping } },
      );
      try {
        const s2 = rt2.store.create({ channel: 'cli' });
        const r2 = await runTurn(rt2, { session: s2, input: 'go', policy: policy() });
        expect(r2.iterations).toBe(2);
        expect(r2.finishReason).toBe('length');
        expect(r2.text).toContain('maxIterations');
      } finally {
        await rt2.cleanup();
      }
    } finally {
      await rt.cleanup();
    }
  });

  it('compresses long histories into a summary', async () => {
    const rt = await makeRuntime({ agent: { contextWindow: 400 } });
    try {
      const session = rt.store.create({ channel: 'cli' });
      const { events, onEvent } = collect();
      for (let i = 0; i < 8; i++)
        await runTurn(rt, {
          session,
          input: `message number ${i} ${'blah '.repeat(30)}`,
          policy: policy(),
          onEvent,
        });
      const s = rt.store.get(session.id)!;
      expect(s.summary).toBeTruthy();
      expect(s.summaryUpto).toBeGreaterThan(0);
      expect(events.some((e) => e.type === 'compress')).toBe(true);
      // undo removes the last turn and the model still answers
      const removed = rt.store.undoLastTurn(session.id);
      expect(removed).toContain('message number 7');
      const after = await runTurn(rt, { session, input: 'after undo', policy: policy() });
      expect(after.text).toBe('echo: after undo');
    } finally {
      await rt.cleanup();
    }
  });
});

describe('context builder', () => {
  it('creates identity files, picks up AGENTS.md and describes the environment', async () => {
    const rt = await makeRuntime();
    try {
      const created = ensureIdentityFiles(rt.paths);
      // 3 identity files + the bundled skills
      expect(created.filter((f) => f.endsWith('.md'))).toHaveLength(3);
      expect(created.length).toBeGreaterThan(3);
      expect(ensureIdentityFiles(rt.paths)).toHaveLength(0);
      const proj = path.join(rt.paths.workspace, 'proj/sub');
      fs.mkdirSync(proj, { recursive: true });
      fs.writeFileSync(path.join(rt.paths.workspace, 'proj/AGENTS.md'), '# Rules\nuse tabs');
      expect(findProjectContext(proj, rt.home)).toHaveLength(1);
      const prompt = buildSystemPrompt({
        config: rt.config,
        paths: rt.paths,
        platform: rt.platform,
        lang: 'ar',
        cwd: proj,
        workspace: rt.paths.workspace,
        tools: rt.tools.list(),
        approvalMode: 'ask',
      });
      expect(prompt).toContain('SINDAR');
      expect(prompt).toContain('use tabs');
      expect(prompt).toContain('`read_file`');
      expect(prompt).toContain('Approval mode is "ask"');
      expect(prompt).toContain(`Working directory: ${proj}`);
      expect(estimateTokens('مرحبا بالعالم')).toBeGreaterThan(estimateTokens('hello world') - 2);
    } finally {
      await rt.cleanup();
    }
  });
});

describe('loop guards', () => {
  it('skips the same tool call repeated with identical arguments', async () => {
    const call = (n: number) => ({
      text: '',
      toolCalls: [{ id: `c${n}`, name: 'list_dir', arguments: '{"path":"."}' }],
    });
    const looping = createMockProvider({
      script: [call(1), call(2), call(3), call(4), { text: 'done looping' }],
    });
    const rt = await makeRuntime(
      { model: { default: 'loop:m' }, providers: { loop: { type: 'mock' } } },
      { instances: { loop: looping } },
    );
    try {
      const session = rt.store.create({ channel: 'cli', cwd: rt.paths.workspace });
      const { events, onEvent } = collect();
      const res = await runTurn(rt, { session, input: 'list', policy: policy('yolo'), onEvent });
      expect(res.text).toBe('done looping');
      expect(events.filter((e) => e.type === 'tool_start').length).toBe(2);
      const denied = events.filter((e) => e.type === 'tool_denied');
      expect(denied.length).toBe(2);
      expect(denied[0]).toMatchObject({ reason: 'repeat' });
      const toolMsgs = rt.store.messages(session.id).filter((m) => m.role === 'tool');
      expect(toolMsgs[0]?.content).toContain('(empty directory)');
      expect(toolMsgs[2]?.content).toMatch(/already ran list_dir/);
    } finally {
      await rt.cleanup();
    }
  });

  it('waits and retries on a rate limit when no fallback is left', async () => {
    const busy = createMockProvider({
      script: [
        { error: { message: 'HTTP 429 — try again in 0.01s', code: 'rate_limit' } },
        { text: 'after wait' },
      ],
    });
    const rt = await makeRuntime(
      { model: { default: 'busy:m', fallbacks: [] }, providers: { busy: { type: 'mock' } } },
      { instances: { busy } },
    );
    try {
      const session = rt.store.create({ channel: 'cli' });
      const { events, onEvent } = collect();
      const res = await runTurn(rt, { session, input: 'hi', policy: policy(), onEvent });
      expect(res.text).toBe('after wait');
      const wait = events.find((e) => e.type === 'retry_wait');
      expect(wait).toMatchObject({ model: 'busy:m', attempt: 1 });
    } finally {
      await rt.cleanup();
    }
  });
});
