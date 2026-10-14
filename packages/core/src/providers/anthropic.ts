import type { ResolvedProvider } from './resolve.js';
import {
  httpError,
  isAbortError,
  joinUrl,
  networkError,
  parseSse,
  withTimeout,
  type FetchLike,
} from './http.js';
import type { HttpProviderOptions } from './openai-compat.js';
import {
  ProviderError,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type FinishReason,
  type ModelInfo,
  type PingResult,
  type Provider,
  type ToolCall,
} from './types.js';

const API_VERSION = '2023-06-01';

function parseDataUrl(url: string): { mediaType: string; data: string } | undefined {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) return undefined;
  return { mediaType: m[1]!, data: m[3]! };
}

/** Convert generic messages into Anthropic's strictly alternating user/assistant blocks. */
export function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string;
  messages: unknown[];
} {
  const system: string[] = [];
  const out: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = [];
  const push = (role: 'user' | 'assistant', blocks: unknown[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') system.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: m.toolCallId ?? '',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
        },
      ]);
      continue;
    }
    const blocks: unknown[] = [];
    if (typeof m.content === 'string') {
      if (m.content) blocks.push({ type: 'text', text: m.content });
    } else if (m.content) {
      for (const p of m.content) {
        if (p.type === 'text') blocks.push({ type: 'text', text: p.text });
        else {
          const d = parseDataUrl(p.url);
          blocks.push(
            d
              ? { type: 'image', source: { type: 'base64', media_type: d.mediaType, data: d.data } }
              : { type: 'image', source: { type: 'url', url: p.url } },
          );
        }
      }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const c of m.toolCalls) {
        let input: unknown = {};
        try {
          input = c.arguments ? JSON.parse(c.arguments) : {};
        } catch {
          input = { _raw: c.arguments };
        }
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input });
      }
    }
    if (blocks.length === 0) continue;
    push(m.role === 'assistant' ? 'assistant' : 'user', blocks);
  }
  // Anthropic requires the first message to be from the user.
  if (out[0]?.role === 'assistant')
    out.unshift({ role: 'user', content: [{ type: 'text', text: '(continue)' }] });
  return { system: system.length ? system.join('\n\n') : undefined, messages: out };
}

export function createAnthropicProvider(
  r: ResolvedProvider,
  opts: HttpProviderOptions = {},
): Provider {
  const fetchImpl: FetchLike = opts.fetch ?? fetch;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 30_000;
  const baseUrl = r.baseUrl ?? 'https://api.anthropic.com';
  const headers = () => ({
    'content-type': 'application/json',
    'anthropic-version': API_VERSION,
    'x-api-key': r.apiKey ?? '',
    'user-agent': opts.userAgent ?? 'sindar',
    ...r.headers,
  });

  async function* chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    if (!r.apiKey)
      throw new ProviderError(
        `${r.id}: no API key (${r.apiKeyEnv ?? 'apiKey'})`,
        'auth',
        undefined,
        false,
      );
    const conv = toAnthropicMessages(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      messages: conv.messages,
      ...(conv.system ? { system: conv.system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
            ...(req.toolChoice
              ? { tool_choice: { type: req.toolChoice === 'required' ? 'any' : req.toolChoice } }
              : {}),
          }
        : {}),
      ...req.extra,
    };
    const t = withTimeout(connectTimeoutMs, signal);
    let res: Response;
    try {
      res = await fetchImpl(joinUrl(baseUrl, 'v1/messages'), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: t.signal,
      });
    } catch (err) {
      t.clear();
      if (signal?.aborted || isAbortError(err)) {
        yield { type: 'done', finishReason: 'cancelled' };
        return;
      }
      throw networkError(err, r.id);
    }
    t.clear();
    if (!res.ok) throw await httpError(res, r.id);

    let inputTokens = 0;
    let outputTokens = 0;
    let stop: FinishReason = 'stop';
    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();
    const toolCalls: ToolCall[] = [];
    try {
      for await (const msg of parseSse(res.body, signal)) {
        if (signal?.aborted) break;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(msg.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = (ev.type as string) ?? msg.event;
        switch (type) {
          case 'message_start': {
            const u = (ev.message as { usage?: { input_tokens?: number } })?.usage;
            inputTokens = u?.input_tokens ?? 0;
            break;
          }
          case 'content_block_start': {
            const cb = ev.content_block as {
              type: string;
              id?: string;
              name?: string;
              text?: string;
            };
            blocks.set(ev.index as number, { type: cb.type, id: cb.id, name: cb.name, json: '' });
            if (cb.type === 'text' && cb.text) yield { type: 'text', delta: cb.text };
            break;
          }
          case 'content_block_delta': {
            const d = ev.delta as {
              type: string;
              text?: string;
              partial_json?: string;
              thinking?: string;
            };
            if (d.type === 'text_delta' && d.text) yield { type: 'text', delta: d.text };
            else if (d.type === 'thinking_delta' && d.thinking)
              yield { type: 'reasoning', delta: d.thinking };
            else if (d.type === 'input_json_delta') {
              const b = blocks.get(ev.index as number);
              if (b) b.json += d.partial_json ?? '';
            }
            break;
          }
          case 'content_block_stop': {
            const b = blocks.get(ev.index as number);
            if (b?.type === 'tool_use') {
              const call: ToolCall = {
                id: b.id ?? `call_${toolCalls.length + 1}`,
                name: b.name ?? '',
                arguments: b.json || '{}',
              };
              toolCalls.push(call);
              yield { type: 'tool_call', call };
            }
            break;
          }
          case 'message_delta': {
            const d = ev.delta as { stop_reason?: string };
            const u = ev.usage as { output_tokens?: number } | undefined;
            if (u?.output_tokens !== undefined) outputTokens = u.output_tokens;
            if (d?.stop_reason)
              stop =
                d.stop_reason === 'tool_use'
                  ? 'tool_calls'
                  : d.stop_reason === 'max_tokens'
                    ? 'length'
                    : 'stop';
            break;
          }
          case 'error': {
            const e = ev.error as { type?: string; message?: string };
            const code =
              e?.type === 'overloaded_error'
                ? 'server'
                : e?.type === 'rate_limit_error'
                  ? 'rate_limit'
                  : 'server';
            throw new ProviderError(`${r.id}: ${e?.message ?? 'stream error'}`, code);
          }
          default:
            break;
        }
      }
    } catch (err) {
      if (signal?.aborted) {
        yield { type: 'done', finishReason: 'cancelled' };
        return;
      }
      if (err instanceof ProviderError) throw err;
      throw networkError(err, r.id);
    }
    if (signal?.aborted) {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield { type: 'usage', usage: { inputTokens, outputTokens } };
    yield { type: 'done', finishReason: toolCalls.length ? 'tool_calls' : stop };
  }

  async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    if (r.models?.length) return r.models.map((id) => ({ id }));
    const t = withTimeout(connectTimeoutMs, signal);
    try {
      const res = await fetchImpl(joinUrl(baseUrl, 'v1/models?limit=100'), {
        headers: headers(),
        signal: t.signal,
      });
      if (!res.ok) throw await httpError(res, r.id);
      const j = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
      return (j.data ?? []).map((m) => ({ id: m.id, name: m.display_name }));
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw networkError(err, r.id, signal?.aborted);
    } finally {
      t.clear();
    }
  }

  async function ping(signal?: AbortSignal): Promise<PingResult> {
    const started = Date.now();
    if (!r.apiKey) return { ok: false, message: `missing ${r.apiKeyEnv ?? 'API key'}` };
    try {
      await listModels(signal);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, message: (err as Error).message, latencyMs: Date.now() - started };
    }
  }

  return {
    id: r.id,
    kind: 'anthropic',
    capabilities: { tools: true, vision: true, streaming: true },
    chat,
    listModels,
    ping,
  };
}
