import { describe, expect, it } from 'vitest';
import { createOpenAICompatProvider, isChatModelId } from '../src/providers/openai-compat.js';
import { createAnthropicProvider, toAnthropicMessages } from '../src/providers/anthropic.js';
import { parseSse, errorMessageFromBody } from '../src/providers/http.js';
import { collectChat, ProviderError } from '../src/providers/types.js';
import { resolveProvider } from '../src/providers/resolve.js';
import { guessContextWindow, ProviderRegistry } from '../src/providers/registry.js';
import { ConfigSchema } from '../src/config/schema.js';

const sse = (events: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const e of events) c.enqueue(enc.encode(e));
      c.close();
    },
  });

const fakeFetch = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) =>
  (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {})) as typeof fetch;

const groq = resolveProvider('groq', undefined, { GROQ_API_KEY: 'gsk_test' })!;

describe('SSE parser', () => {
  it('handles chunk boundaries, CRLF and comments', async () => {
    const out: string[] = [];
    for await (const m of parseSse(
      sse([
        'data: {"a":1}\n\n:keepalive\n\ndata: {"b"',
        ':2}\r\n\r\nevent: x\ndata: 1\ndata: 2\n\n',
      ]),
    ))
      out.push(`${m.event ?? ''}|${m.data}`);
    expect(out).toEqual(['|{"a":1}', '|{"b":2}', 'x|1\n2']);
    expect(errorMessageFromBody('{"error":{"message":"bad key"}}')).toBe('bad key');
    expect(errorMessageFromBody('plain')).toBe('plain');
  });
});

describe('openai-compat provider', () => {
  it('streams text, accumulates tool call deltas and reports usage', async () => {
    let body: Record<string, unknown> = {};
    const p = createOpenAICompatProvider(groq, {
      fetch: fakeFetch((url, init) => {
        expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer gsk_test');
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const chunks = [
          { choices: [{ delta: { role: 'assistant', content: 'Hel' } }] },
          { choices: [{ delta: { content: 'lo' } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"pa' } },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              { delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"x"}' } }] } },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
          { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
        ];
        return new Response(
          sse([...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), 'data: [DONE]\n\n']),
          { status: 200 },
        );
      }),
    });
    const res = await collectChat(
      p.chat({
        model: 'llama',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: null,
            toolCalls: [{ id: 't1', name: 'x', arguments: '{}' }],
          },
          { role: 'tool', content: 'r', toolCallId: 't1', name: 'x' },
        ],
        tools: [
          { name: 'read_file', description: 'd', parameters: { type: 'object', properties: {} } },
        ],
      }),
    );
    expect(res.text).toBe('Hello');
    expect(res.toolCalls).toEqual([{ id: 'call_a', name: 'read_file', arguments: '{"path":"x"}' }]);
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(res.finishReason).toBe('tool_calls');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    const msgs = body.messages as Array<Record<string, unknown>>;
    expect(msgs[2]).toMatchObject({ role: 'assistant', content: null });
    expect(msgs[3]).toMatchObject({ role: 'tool', tool_call_id: 't1', content: 'r' });
    expect((body.tools as unknown[]).length).toBe(1);
  });

  it('maps HTTP errors to ProviderError codes and retries without stream_options', async () => {
    const p401 = createOpenAICompatProvider(groq, {
      fetch: fakeFetch(
        () => new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 }),
      ),
    });
    await expect(collectChat(p401.chat({ model: 'm', messages: [] }))).rejects.toMatchObject({
      code: 'auth',
      status: 401,
      retryable: false,
    });
    const p429 = createOpenAICompatProvider(groq, {
      fetch: fakeFetch(() => new Response('rate limited', { status: 429 })),
    });
    await expect(collectChat(p429.chat({ model: 'm', messages: [] }))).rejects.toMatchObject({
      code: 'rate_limit',
      retryable: true,
    });
    let calls = 0;
    const pRetry = createOpenAICompatProvider(groq, {
      fetch: fakeFetch((_u, init) => {
        calls++;
        const b = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (b.stream_options)
          return new Response('{"error":{"message":"unknown field stream_options"}}', {
            status: 400,
          });
        return new Response(
          sse([
            'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
          ]),
        );
      }),
    });
    expect((await collectChat(pRetry.chat({ model: 'm', messages: [] }))).text).toBe('ok');
    expect(calls).toBe(2);
    const noKey = createOpenAICompatProvider(resolveProvider('groq', undefined, {})!, {
      fetch: fakeFetch(() => new Response('')),
    });
    await expect(collectChat(noKey.chat({ model: 'm', messages: [] }))).rejects.toBeInstanceOf(
      ProviderError,
    );
    const down = createOpenAICompatProvider(groq, {
      fetch: fakeFetch(() => {
        throw new TypeError('fetch failed');
      }),
    });
    await expect(collectChat(down.chat({ model: 'm', messages: [] }))).rejects.toMatchObject({
      code: 'network',
    });
    expect(await down.ping()).toMatchObject({ ok: false });
  });

  it('lists models (stripping models/ prefix) and filters non-chat ids', async () => {
    const p = createOpenAICompatProvider(groq, {
      fetch: fakeFetch(
        () =>
          new Response(
            JSON.stringify({
              data: [{ id: 'models/gemini-2.5-flash' }, { id: 'whisper-large-v3' }],
            }),
          ),
      ),
    });
    const models = await p.listModels();
    expect(models.map((m) => m.id)).toEqual(['gemini-2.5-flash', 'whisper-large-v3']);
    expect(isChatModelId('whisper-large-v3')).toBe(false);
    expect(isChatModelId('llama-3.3-70b-versatile')).toBe(true);
    expect(await p.ping()).toMatchObject({ ok: true });
  });
});

describe('anthropic provider', () => {
  it('converts messages into alternating blocks with tool_use/tool_result', () => {
    const conv = toAnthropicMessages([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [{ id: 'tu1', name: 'read_file', arguments: '{"path":"a"}' }],
      },
      { role: 'tool', content: 'file body', toolCallId: 'tu1', name: 'read_file' },
      { role: 'tool', content: 'second', toolCallId: 'tu2', name: 'x' },
    ]);
    expect(conv.system).toBe('sys');
    expect(conv.messages).toHaveLength(3);
    expect((conv.messages[1] as { content: unknown[] }).content[1]).toMatchObject({
      type: 'tool_use',
      id: 'tu1',
      input: { path: 'a' },
    });
    expect((conv.messages[2] as { content: unknown[] }).content).toHaveLength(2);
  });

  it('streams Messages API events', async () => {
    const anthropic = resolveProvider('anthropic', undefined, {
      ANTHROPIC_API_KEY: 'sk-ant-test',
    })!;
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'there' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'list_dir' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"path":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"."}' },
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
      { type: 'message_stop' },
    ];
    const p = createAnthropicProvider(anthropic, {
      fetch: fakeFetch((url, init) => {
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
        return new Response(
          sse(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)),
        );
      }),
    });
    const res = await collectChat(
      p.chat({ model: 'claude', messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(res.text).toBe('Hi there');
    expect(res.toolCalls).toEqual([{ id: 'toolu_1', name: 'list_dir', arguments: '{"path":"."}' }]);
    expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
    expect(res.finishReason).toBe('tool_calls');
  });
});

describe('provider registry', () => {
  it('resolves refs, candidates and context windows', () => {
    const cfg = ConfigSchema.parse({
      model: {
        default: 'groq:llama-3.3-70b-versatile',
        fallbacks: ['gemini:gemini-2.5-flash', 'mock:echo'],
      },
    });
    const reg = new ProviderRegistry(cfg, { GROQ_API_KEY: 'k' });
    expect(reg.candidates()).toEqual([
      'groq:llama-3.3-70b-versatile',
      'gemini:gemini-2.5-flash',
      'mock:echo',
    ]);
    expect(reg.parse('llama-3.1-8b-instant')).toEqual({
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
    });
    expect(reg.target('groq:x').providerId).toBe('groq');
    expect(() => reg.get('gemini')).toThrow(/no API key/);
    expect(() => reg.get('nope')).toThrow(/unknown provider/);
    expect(guessContextWindow('gemini-2.5-flash')).toBe(1_000_000);
    expect(guessContextWindow('unknown-model', 1234)).toBe(1234);
    expect(reg.get('mock').id).toBe('mock');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds, dates and phrases from error text', async () => {
    const { parseRetryAfter } = await import('../src/providers/http.js');
    expect(parseRetryAfter('12')).toBe(12_000);
    expect(parseRetryAfter(null, 'Please try again in 10.9125s. Need more tokens?')).toBe(10_913);
    expect(parseRetryAfter(null, 'retry after 2 seconds')).toBe(2_000);
    expect(parseRetryAfter(null, 'try again in 1m30s')).toBe(90_000);
    expect(parseRetryAfter(null, 'no hint here')).toBeUndefined();
  });
});
