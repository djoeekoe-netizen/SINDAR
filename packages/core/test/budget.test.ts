/**
 * Request-budget safety net: free tiers (Groq 8k "tokens per minute") reject a single big
 * request with HTTP 413. The loop must shrink what it sends — never what it stores — and
 * learn the cap from the provider's error text.
 */
import { describe, expect, it } from 'vitest';
import { fitToBudget, totalTokens } from '../src/agent/budget.js';
import type { ChatMessage } from '../src/providers/types.js';
import { httpError, isTooLargeMessage, parseTokenLimits } from '../src/providers/http.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ConfigSchema } from '../src/config/schema.js';
import { makeRuntime, policy } from './helpers.js';
import { runTurn, type AgentEvent } from '../src/agent/loop.js';
import { createMockProvider } from '../src/providers/mock.js';

const chars = (n: number, ch = 'x') => ch.repeat(n);

function convo(): ChatMessage[] {
  return [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'first question' },
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'c1', name: 'web_fetch', arguments: '{}' }],
    },
    { role: 'tool', toolCallId: 'c1', name: 'web_fetch', content: chars(20_000, 'a') },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'second question' },
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'c2', name: 'read_file', arguments: '{}' }],
    },
    { role: 'tool', toolCallId: 'c2', name: 'read_file', content: chars(20_000, 'b') },
    { role: 'user', content: 'third question' },
  ];
}

describe('fitToBudget', () => {
  it('leaves a request alone when it fits and never mutates the input', () => {
    const input = convo();
    const copy = JSON.stringify(input);
    const r = fitToBudget(input, 1_000_000);
    expect(r.actions).toEqual([]);
    expect(r.messages).toHaveLength(input.length);
    expect(JSON.stringify(input)).toBe(copy);
  });

  it('stubs old tool outputs first, keeping the recent ones', () => {
    const input = convo();
    const before = totalTokens(input);
    const r = fitToBudget(input, before - 2_000, { keepRecentTools: 1 });
    expect(r.actions).toEqual(['stub_old_tools']);
    const old = r.messages[3]!;
    const recent = r.messages[7]!;
    expect(String(old.content)).toMatch(/older tool output trimmed \(20000 chars\)/);
    expect(String(old.content).length).toBeLessThan(600);
    expect(String(recent.content)).toBe(chars(20_000, 'b'));
    expect(JSON.stringify(input)).toContain(chars(20_000, 'a')); // stored copy intact
  });

  it('then cuts the biggest recent output and says how to get the rest', () => {
    const input = convo();
    const r = fitToBudget(input, 3_000, { keepRecentTools: 1 });
    expect(r.actions).toEqual(['stub_old_tools', 'cut_tool']);
    const recent = String(r.messages[7]!.content);
    expect(recent.length).toBeLessThan(20_000);
    expect(recent).toMatch(/showing \d+ of 20000 chars/);
    expect(recent).toMatch(/offset=\d+/);
    expect(r.tokens).toBeLessThanOrEqual(3_000);
  });

  it('finally drops the oldest rounds but keeps system + the last user turn', () => {
    const input = convo();
    const r = fitToBudget(input, 60, { keepRecentTools: 1, minToolChars: 200, stubChars: 100 });
    expect(r.actions).toContain('drop_oldest');
    const roles = r.messages.map((m) => m.role);
    expect(roles[0]).toBe('system');
    expect(roles[1]).toBe('system'); // "earlier messages omitted" note
    expect(r.messages.at(-1)!.content).toBe('third question');
    // a cut never starts in the middle of an assistant/tool pair
    for (let i = 0; i < r.messages.length; i++) {
      const m = r.messages[i]!;
      if (m.role === 'tool') expect(r.messages[i - 1]!.role).toBe('assistant');
    }
  });

  it('counts Arabic as expensive (≈1.7 chars/token)', () => {
    expect(totalTokens([{ role: 'user', content: 'ع'.repeat(1700) }])).toBeGreaterThanOrEqual(1000);
    expect(totalTokens([{ role: 'user', content: 'a'.repeat(1700) }])).toBeLessThan(500);
  });
});

describe('too-large errors', () => {
  it('classifies Groq 413 and extracts limit / requested', async () => {
    const body = JSON.stringify({
      error: {
        message:
          'Request too large for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 11818, please reduce your message size and try again.',
        type: 'tokens',
        code: 'rate_limit_exceeded',
      },
    });
    const err = await httpError(new Response(body, { status: 413 }), 'groq');
    expect(err.code).toBe('too_large');
    expect(err.retryable).toBe(false);
    expect(err.limitTokens).toBe(8000);
    expect(err.requestedTokens).toBe(11818);
  });

  it('recognises OpenAI / Anthropic phrasing on 400', async () => {
    const openai = JSON.stringify({
      error: {
        message:
          "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens (8000 in the messages, 1000 in the completion). Please reduce the length of the messages or completion.",
        code: 'context_length_exceeded',
      },
    });
    const e1 = await httpError(new Response(openai, { status: 400 }), 'openai');
    expect(e1.code).toBe('too_large');
    expect(e1.limitTokens).toBe(8192);
    expect(e1.requestedTokens).toBe(9000);
    expect(isTooLargeMessage('prompt is too long: 210000 tokens > 200000 maximum')).toBe(true);
    expect(parseTokenLimits('prompt is too long: 210000 tokens > 200000 maximum')).toEqual({
      limit: 200_000,
      requested: 210_000,
    });
    const plain = await httpError(
      new Response('{"error":{"message":"bad json"}}', { status: 400 }),
      'x',
    );
    expect(plain.code).toBe('invalid_request');
    const rate = await httpError(
      new Response('{"error":{"message":"Rate limit reached, try again in 2s"}}', { status: 429 }),
      'x',
    );
    expect(rate.code).toBe('rate_limit');
  });

  it('registry: known free-tier caps, config override, learning and calibration', () => {
    const reg = new ProviderRegistry(ConfigSchema.parse({}), {});
    expect(reg.budget('groq:openai/gpt-oss-120b').tokens).toBe(8000);
    expect(reg.budget('groq:llama-3.3-70b-versatile').tokens).toBe(12_000);
    expect(reg.budget('groq:something-new').tokens).toBe(8000);
    expect(reg.budget('openrouter:free-model').tokens).toBeUndefined();
    expect(reg.budget('groq:openai/gpt-oss-120b').scale).toBe(1);

    // learned from a 413 → 90% of the quoted limit, plus a scale from requested/estimated
    const cap = reg.noteTooLarge('openrouter:free-model', 8000, 11_818, 6_000);
    expect(cap).toBe(7200);
    expect(reg.budget('openrouter:free-model').tokens).toBe(7200);
    expect(reg.budget('openrouter:free-model').scale).toBeCloseTo(11_818 / 6_000, 2);
    // a second 413 without numbers shrinks further
    expect(reg.noteTooLarge('openrouter:free-model', undefined, undefined, 7_000)).toBe(5600);

    // calibration moves the scale towards reality
    reg.calibrate('groq:openai/gpt-oss-120b', 1000, 2000);
    expect(reg.budget('groq:openai/gpt-oss-120b').scale).toBe(2);
    reg.calibrate('groq:openai/gpt-oss-120b', 1000, 1000);
    expect(reg.budget('groq:openai/gpt-oss-120b').scale).toBe(1.5);

    const cfg = new ProviderRegistry(ConfigSchema.parse({ agent: { inputBudget: 50_000 } }), {});
    expect(cfg.budget('groq:openai/gpt-oss-120b').tokens).toBe(50_000);
  });
});

describe('agent loop on a tiny request cap', () => {
  it('shrinks and retries on a too-large error, then keeps requests under the learned cap', async () => {
    const big = createMockProvider({
      script: [
        {
          error: {
            code: 'too_large',
            message:
              'HTTP 413 — Request too large for model `m` on tokens per minute (TPM): Limit 8000, Requested 11818, please reduce your message size and try again.',
          },
        },
        { text: 'short answer' },
      ],
    });
    const rt = await makeRuntime(
      { model: { default: 'big:m', fallbacks: [] }, providers: { big: { type: 'mock' } } },
      { instances: { big } },
    );
    try {
      const session = rt.store.create({ channel: 'cli' });
      // History with a huge Arabic tool result, like a fetched news page.
      rt.store.append(session.id, { role: 'user', content: 'لخّص لي هذا' });
      rt.store.append(session.id, {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'c1', name: 'web_fetch', arguments: '{"url":"https://x"}' }],
      });
      rt.store.append(session.id, {
        role: 'tool',
        toolCallId: 'c1',
        name: 'web_fetch',
        content: 'أخبار الذكاء الاصطناعي '.repeat(1500),
      });
      const events: AgentEvent[] = [];
      const res = await runTurn(rt, {
        session,
        input: 'حاول مرة أخرى',
        policy: policy(),
        onEvent: (e) => events.push(e),
      });
      expect(res.text).toBe('short answer');
      expect(big.requests).toHaveLength(2);
      const toolMsg = (i: number) =>
        String(big.requests[i]!.messages.find((m) => m.role === 'tool')!.content);
      expect(toolMsg(1).length).toBeLessThan(toolMsg(0).length);
      expect(toolMsg(1)).toMatch(/trimmed|offset=/);
      expect(events.find((e) => e.type === 'notice')).toBeTruthy();
      expect(rt.registry.budget('big:m').tokens).toBe(7200);
      // the stored history is untouched
      const stored = rt.store.messages(session.id).find((m) => m.role === 'tool')!;
      expect(String(stored.content).length).toBeGreaterThan(30_000);
    } finally {
      await rt.cleanup();
    }
  });

  it('gives a clear error when even the smallest request is too large', async () => {
    const tiny = createMockProvider({
      script: Array.from({ length: 5 }, () => ({
        error: {
          code: 'too_large' as const,
          message: 'Request too large: Limit 10, Requested 500',
        },
      })),
    });
    const rt = await makeRuntime(
      { model: { default: 'tiny:m', fallbacks: [] }, providers: { tiny: { type: 'mock' } } },
      { instances: { tiny } },
    );
    try {
      const session = rt.store.create({ channel: 'cli' });
      await expect(runTurn(rt, { session, input: 'hello', policy: policy() })).rejects.toThrow(
        /bigger than this free model allows|أكبر من حد النموذج/,
      );
      expect(tiny.requests.length).toBeLessThanOrEqual(4);
    } finally {
      await rt.cleanup();
    }
  });
});
