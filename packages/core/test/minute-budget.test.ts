/**
 * Free tiers meter tokens per minute across requests (Groq: "Limit 8000, Used 6895, Requested
 * 7693, try again in 49.41s"). These tests cover the sliding window, the 429 parsing and the
 * loop's pacing: switch to a fallback with room, or wait for the window instead of failing.
 */
import { describe, expect, it } from 'vitest';
import { httpError } from '../src/providers/http.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ConfigSchema } from '../src/config/schema.js';
import { makeRuntime, policy } from './helpers.js';
import { runTurn, type AgentEvent } from '../src/agent/loop.js';
import { createMockProvider } from '../src/providers/mock.js';

const GROQ_429 =
  'Rate limit reached for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 6895, Requested 7693. Please try again in 49.41s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing';

function registry(): ProviderRegistry {
  const config = ConfigSchema.parse({
    model: { default: 'groq:openai/gpt-oss-20b' },
    providers: { groq: { type: 'openai-compat', baseUrl: 'https://x', apiKeyEnv: 'K' } },
  });
  return new ProviderRegistry(config, { K: 'k' });
}

describe('per-minute 429 parsing', () => {
  it('extracts limit / used / requested / retry-after and flags the limit as per-minute', async () => {
    const err = await httpError(
      new Response(JSON.stringify({ error: { message: GROQ_429, type: 'tokens' } }), {
        status: 429,
      }),
      'groq',
    );
    expect(err.code).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.perMinute).toBe(true);
    expect(err.limitTokens).toBe(8000);
    expect(err.usedTokens).toBe(6895);
    expect(err.requestedTokens).toBe(7693);
    expect(err.retryAfterMs).toBe(49_410);
    const rpm = await httpError(
      new Response(
        '{"error":{"message":"Rate limit reached: requests per day (RPD): Limit 1000, Used 1000"}}',
        {
          status: 429,
        },
      ),
      'groq',
    );
    expect(rpm.perMinute).toBe(false);
    expect(rpm.usedTokens).toBeUndefined();
  });
});

describe('registry minute window', () => {
  const ref = 'groq:openai/gpt-oss-20b';

  it('knows the free-tier minute limit and paces requests through a sliding window', () => {
    const reg = registry();
    const t0 = 1_000_000;
    expect(reg.minuteLimit(ref)).toBe(8000);
    expect(reg.minuteWait(ref, 3000, t0)).toBe(0);
    reg.noteUsage(ref, 3400, t0); // the request that decided to call web_fetch
    expect(reg.minuteUsed(ref, t0 + 1000)).toBe(3400);
    expect(reg.minuteWait(ref, 4000, t0 + 1000)).toBe(0); // 3400 + 4000 ≤ 8000
    // the follow-up with the page does not fit until the first request leaves the window
    const wait = reg.minuteWait(ref, 7700, t0 + 10_000);
    expect(wait).toBeGreaterThan(49_000);
    expect(wait).toBeLessThanOrEqual(50_500);
    expect(reg.minuteWait(ref, 7700, t0 + 61_000)).toBe(0);
    // something that can never fit is not this window's problem (the per-request cap handles it)
    expect(reg.minuteWait(ref, 9000, t0 + 10_000)).toBe(0);
    // unknown providers have no minute cap
    expect(reg.minuteLimit('openai:gpt-4o')).toBeUndefined();
    expect(reg.minuteWait('openai:gpt-4o', 50_000)).toBe(0);
  });

  it('aligns the window with the numbers a 429 quotes', () => {
    const reg = registry();
    const t0 = 5_000_000;
    reg.noteRateLimit(ref, { limit: 8000, used: 6895, retryAfterMs: 49_410 }, t0);
    expect(reg.minuteUsed(ref, t0)).toBe(6895);
    expect(reg.minuteWait(ref, 1000, t0)).toBe(0); // 6895 + 1000 fits
    const w = reg.minuteWait(ref, 7693, t0);
    expect(w).toBeGreaterThanOrEqual(49_410);
    expect(w).toBeLessThan(50_000);
    expect(reg.minuteWait(ref, 7693, t0 + 49_700)).toBe(0);
    // a learned limit overrides the table
    reg.noteRateLimit(ref, { limit: 6000 }, t0);
    expect(reg.minuteLimit(ref)).toBe(6000);
  });
});

describe('agent loop pacing', () => {
  const collect = () => {
    const events: AgentEvent[] = [];
    return { events, onEvent: (e: AgentEvent) => events.push(e) };
  };

  it('moves to a fallback with room instead of burning a request on a certain 429', async () => {
    const primary = createMockProvider({ script: [{ text: 'from primary' }] });
    const spare = createMockProvider({ script: [{ text: 'from spare' }] });
    const rt = await makeRuntime(
      {
        model: { default: 'groq:openai/gpt-oss-20b', fallbacks: ['groq:llama-3.3-70b-versatile'] },
        providers: { groq: { type: 'mock' } },
      },
      { instances: { groq: primary } },
    );
    // the registry resolves both refs to the same mock instance; tell them apart by the model name
    const seen: string[] = [];
    const orig = primary.chat.bind(primary);
    primary.chat = (req, signal) => {
      seen.push(req.model);
      return req.model.includes('llama') ? spare.chat(req, signal) : orig(req, signal);
    };
    try {
      // primary minute is full for the next ~50 s
      rt.registry.noteRateLimit('groq:openai/gpt-oss-20b', {
        limit: 8000,
        used: 7900,
        retryAfterMs: 50_000,
      });
      const session = rt.store.create({ channel: 'cli' });
      const { events, onEvent } = collect();
      const res = await runTurn(rt, { session, input: 'hi', policy: policy(), onEvent });
      expect(res.text).toBe('from spare');
      expect(seen).toEqual(['llama-3.3-70b-versatile']);
      const sw = events.find((e) => e.type === 'model_switch');
      expect(sw).toMatchObject({
        from: 'groq:openai/gpt-oss-20b',
        to: 'groq:llama-3.3-70b-versatile',
      });
      expect(events.some((e) => e.type === 'retry_wait')).toBe(false);
    } finally {
      await rt.cleanup();
    }
  });

  it('waits for the window (short pause, no model switch) and learns from a per-minute 429', async () => {
    const groq = createMockProvider({
      script: [
        {
          error: {
            message: `HTTP 429 — ${GROQ_429.replace('49.41s', '0.3s')}`,
            code: 'rate_limit',
          },
        },
        { text: 'done' },
      ],
    });
    const rt = await makeRuntime(
      {
        model: { default: 'groq:openai/gpt-oss-20b', fallbacks: [] },
        providers: { groq: { type: 'mock' } },
      },
      { instances: { groq } },
    );
    try {
      const session = rt.store.create({ channel: 'cli' });
      const { events, onEvent } = collect();
      const res = await runTurn(rt, { session, input: 'hi', policy: policy(), onEvent });
      expect(res.text).toBe('done');
      const wait = events.find((e) => e.type === 'retry_wait');
      expect(wait).toMatchObject({ model: 'groq:openai/gpt-oss-20b', seconds: 1 });
      expect((wait as { reason: string }).reason).toMatch(/per-minute|الدقيقة/);
      expect(rt.registry.minuteLimit('groq:openai/gpt-oss-20b')).toBe(8000);
      expect(groq.requests.length).toBe(2);
      // the successful call was recorded against the minute window
      expect(rt.registry.minuteUsed('groq:openai/gpt-oss-20b')).toBeGreaterThan(0);
    } finally {
      await rt.cleanup();
    }
  });
});
