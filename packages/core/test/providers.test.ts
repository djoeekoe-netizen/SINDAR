import { describe, expect, it } from 'vitest';
import { createMockProvider } from '../src/providers/mock.js';
import { collectChat, type ChatEvent } from '../src/providers/types.js';
import { parseModelRef, formatModelRef } from '../src/providers/model-ref.js';
import { resolveProvider, resolveProviders } from '../src/providers/resolve.js';
import { PROVIDER_TEMPLATES, getProviderTemplate } from '../src/providers/templates.js';
import { ConfigSchema } from '../src/config/schema.js';

describe('model refs', () => {
  it('splits provider:model keeping colons in the model', () => {
    expect(parseModelRef('groq:llama-3.3-70b-versatile')).toEqual({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
    });
    expect(parseModelRef('ollama:qwen3:8b')).toEqual({ provider: 'ollama', model: 'qwen3:8b' });
    expect(parseModelRef('gpt-4o-mini')).toEqual({ model: 'gpt-4o-mini' });
    expect(parseModelRef('http://x')).toEqual({ model: 'http://x' });
    expect(formatModelRef({ provider: 'a', model: 'b:c' })).toBe('a:b:c');
  });
});

describe('provider templates & resolution', () => {
  it('every template is well formed and free-first', () => {
    const ids = new Set<string>();
    for (const t of PROVIDER_TEMPLATES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      if (t.kind !== 'mock') expect(t.baseUrl).toMatch(/^https?:\/\//);
      if (t.requiresKey) expect(t.apiKeyEnv).toBeTruthy();
      if (t.free === 'free-tier') expect(t.signupUrl).toBeTruthy();
    }
    expect(PROVIDER_TEMPLATES.filter((t) => t.free === 'local').length).toBeGreaterThanOrEqual(2);
    expect(PROVIDER_TEMPLATES.filter((t) => t.free === 'free-tier').length).toBeGreaterThanOrEqual(
      4,
    );
    expect(getProviderTemplate('groq')?.apiKeyEnv).toBe('GROQ_API_KEY');
  });

  it('marks providers configured only when a key is present (or not needed)', () => {
    const cfg = ConfigSchema.parse({});
    const none = resolveProviders(cfg, {});
    expect(none.find((p) => p.id === 'groq')?.configured).toBe(false);
    expect(none.find((p) => p.id === 'ollama')?.configured).toBe(true);
    expect(none.find((p) => p.id === 'mock')?.configured).toBe(true);
    const withKey = resolveProviders(cfg, { GROQ_API_KEY: 'gsk_test_1234567890' });
    const groq = withKey.find((p) => p.id === 'groq')!;
    expect(groq.configured).toBe(true);
    expect(groq.apiKey).toBe('gsk_test_1234567890');
  });

  it('lets user config override templates and define custom providers', () => {
    const cfg = ConfigSchema.parse({
      providers: {
        ollama: { baseUrl: 'http://10.0.0.5:11434/v1' },
        mine: { type: 'openai-compat', baseUrl: 'https://llm.example/v1', apiKeyEnv: 'MINE_KEY' },
      },
    });
    const all = resolveProviders(cfg, { MINE_KEY: 'k' });
    expect(all.find((p) => p.id === 'ollama')?.baseUrl).toBe('http://10.0.0.5:11434/v1');
    const mine = all.find((p) => p.id === 'mine')!;
    expect(mine.fromTemplate).toBe(false);
    expect(mine.configured).toBe(true);
    expect(resolveProvider('nope', undefined, {})).toBeUndefined();
    // env-based base URL override
    expect(
      resolveProvider('ollama', undefined, { OLLAMA_BASE_URL: 'http://h:1/v1' })?.baseUrl,
    ).toBe('http://h:1/v1');
  });
});

describe('mock provider', () => {
  it('echoes the last user message as a stream with usage', async () => {
    const p = createMockProvider({ chunkSize: 3 });
    const events: ChatEvent[] = [];
    for await (const ev of p.chat({
      model: 'echo',
      messages: [{ role: 'user', content: 'hello there' }],
    }))
      events.push(ev);
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length).toBeGreaterThan(1);
    const out = await collectChat(
      p.chat({ model: 'echo', messages: [{ role: 'user', content: 'hello there' }] }),
    );
    expect(out.text).toBe('echo: hello there');
    expect(out.finishReason).toBe('stop');
    expect(out.usage?.outputTokens).toBeGreaterThan(0);
    expect(p.requests).toHaveLength(2);
  });

  it('emits tool calls for !tool directives and acknowledges tool results', async () => {
    const p = createMockProvider();
    const out = await collectChat(
      p.chat({
        model: 'echo',
        messages: [{ role: 'user', content: '!tool read_file {"path":"a.txt"}' }],
      }),
    );
    expect(out.toolCalls).toEqual([
      { id: 'call_1', name: 'read_file', arguments: '{"path":"a.txt"}' },
    ]);
    expect(out.finishReason).toBe('tool_calls');
    const ack = await collectChat(
      p.chat({
        model: 'echo',
        messages: [
          { role: 'user', content: 'x' },
          { role: 'tool', name: 'read_file', toolCallId: 'call_1', content: 'file body' },
        ],
      }),
    );
    expect(ack.text).toBe('tool-result:read_file:file body');
  });

  it('plays scripted turns, including errors and cancellation', async () => {
    const p = createMockProvider({
      script: [{ text: 'first' }, { error: { message: 'quota', code: 'rate_limit' } }],
      chunkSize: 2,
    });
    expect((await collectChat(p.chat({ model: 'echo', messages: [] }))).text).toBe('first');
    const failed = await collectChat(p.chat({ model: 'echo', messages: [] }));
    expect(failed.error?.code).toBe('rate_limit');
    expect(failed.error?.retryable).toBe(true);
    const ac = new AbortController();
    ac.abort();
    const cancelled = await collectChat(
      p.chat(
        { model: 'echo', messages: [{ role: 'user', content: 'long message here' }] },
        ac.signal,
      ),
    );
    expect(cancelled.finishReason).toBe('cancelled');
    expect(await p.ping()).toMatchObject({ ok: true });
  });
});
