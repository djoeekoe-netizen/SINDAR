/**
 * Providers retire model ids under running installs (Google: "models/gemini-2.5-flash is no longer
 * available to new users"; Groq: "The model `llama-3.3-70b-versatile` does not exist"). The loop
 * must confirm with the live list, continue on a surviving sibling, persist the swap and — when
 * everything fails — name every model it tried instead of only the last one.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runTurn, type AgentEvent } from '../src/agent/loop.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { ProviderError, type ChatEvent, type Provider } from '../src/providers/types.js';
import { makeRuntime, policy } from './helpers.js';

/** A provider whose live list no longer contains some of the configured ids. */
function fakeProvider(
  live: string[],
  reply = (m: string) => `hi from ${m}`,
): Provider & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    id: 'fake',
    kind: 'openai-compat',
    capabilities: { tools: true, vision: false, streaming: true },
    calls,
    listModels: async () => live.map((id) => ({ id, name: id })),
    ping: async () => ({ ok: true, message: 'ok', latencyMs: 1 }),
    chat(req) {
      calls.push(req.model);
      if (!live.includes(req.model)) {
        throw new ProviderError(
          `fake: HTTP 404 — The model \`${req.model}\` does not exist or you do not have access to it.`,
          'not_found',
          404,
          false,
        );
      }
      async function* gen(): AsyncIterable<ChatEvent> {
        yield { type: 'text', delta: reply(req.model) };
        yield { type: 'done', finishReason: 'stop' };
      }
      return gen();
    },
  } as Provider & { calls: string[] };
}

const providers = {
  fake: { type: 'openai-compat' as const, baseUrl: 'https://x', apiKeyEnv: 'K' },
};

describe('retired models', () => {
  it('recognises retirement errors', () => {
    expect(
      ProviderRegistry.looksRetired(
        new ProviderError('gemini: HTTP 404 — This model is no longer available', 'not_found', 404),
      ),
    ).toBe(true);
    expect(ProviderRegistry.looksRetired(new ProviderError('fetch failed', 'network'))).toBe(false);
    expect(ProviderRegistry.looksRetired(new ProviderError('HTTP 429', 'rate_limit', 429))).toBe(
      false,
    );
  });

  it('swaps a retired default for a live sibling, persists it and answers', async () => {
    const provider = fakeProvider(['new-flash', 'new-flash-lite', 'tts-1']);
    const rt = await makeRuntime(
      {
        model: {
          default: 'fake:old-flash',
          fallbacks: ['fake:old-flash-lite', 'fake:new-flash-lite'],
        },
        providers,
      },
      { instances: { fake: provider } },
      { K: 'k' },
    );
    try {
      fs.writeFileSync(rt.paths.config, 'model:\n  default: fake:old-flash\n');
      const session = rt.store.create({ channel: 'cli', cwd: rt.paths.workspace });
      const events: AgentEvent[] = [];
      const res = await runTurn(rt, {
        session,
        input: 'hello',
        policy: policy(),
        onEvent: (e) => events.push(e),
      });
      expect(res.text).toBe('hi from new-flash');
      // one failed call, then straight to the replacement (not through the other dead fallback)
      expect(provider.calls).toEqual(['old-flash', 'new-flash']);
      const notice = events.find((e) => e.type === 'notice');
      expect(notice && 'message' in notice ? notice.message : '').toContain('fake:new-flash');
      // in-memory config and config.yaml both updated; the dead fallback dropped, the live one kept
      expect(rt.config.model.default).toBe('fake:new-flash');
      expect(rt.config.model.fallbacks).toEqual(['fake:old-flash-lite', 'fake:new-flash-lite']);
      expect(fs.readFileSync(rt.paths.config, 'utf8')).toContain('default: fake:new-flash');
      // the next turn does not pay for the dead model again
      const again = await runTurn(rt, { session, input: 'again', policy: policy() });
      expect(again.text).toBe('hi from new-flash');
      expect(provider.calls.slice(2)).toEqual(['new-flash']);
      expect(rt.registry.candidates()).toEqual([
        'fake:new-flash',
        'fake:old-flash-lite',
        'fake:new-flash-lite',
      ]);
    } finally {
      await rt.cleanup();
    }
  });

  it('a session pinned to a retired model moves to the replacement too', async () => {
    const provider = fakeProvider(['new-flash']);
    const rt = await makeRuntime(
      { model: { default: 'fake:new-flash' }, providers },
      { instances: { fake: provider } },
      { K: 'k' },
    );
    try {
      const session = rt.store.create({
        channel: 'telegram',
        cwd: rt.paths.workspace,
        model: 'fake:old-flash',
      });
      const res = await runTurn(rt, { session, input: 'hello', policy: policy() });
      expect(res.text).toBe('hi from new-flash');
      expect(rt.store.get(session.id)?.model).toBe('fake:new-flash');
      // the configured default still sits right after a session's explicit pick
      expect(rt.registry.candidates('fake:other')).toEqual(['fake:other', 'fake:new-flash']);
    } finally {
      await rt.cleanup();
    }
  });

  it('lists every model that failed when nothing is left', async () => {
    const provider = fakeProvider(['new-flash'], () => {
      throw new ProviderError('fake: HTTP 400 — bad tool schema', 'invalid_request', 400, false);
    });
    const rt = await makeRuntime(
      { model: { default: 'fake:new-flash', fallbacks: ['fake:gone'] }, providers },
      { instances: { fake: provider } },
      { K: 'k' },
    );
    try {
      const session = rt.store.create({ channel: 'cli', cwd: rt.paths.workspace });
      await expect(runTurn(rt, { session, input: 'hello', policy: policy() })).rejects.toThrow(
        /Tried 2 models, none worked:\n• fake:new-flash — fake: HTTP 400 — bad tool schema\n• fake:gone — fake: HTTP 404/,
      );
    } finally {
      await rt.cleanup();
    }
  });
});
