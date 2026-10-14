import type { ResolvedProvider } from './resolve.js';
import {
  authHeaders,
  httpError,
  isAbortError,
  joinUrl,
  networkError,
  parseSse,
  withTimeout,
  type FetchLike,
} from './http.js';
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
  type Usage,
} from './types.js';

export interface HttpProviderOptions {
  fetch?: FetchLike;
  /** Timeout for establishing the response (headers), ms. */
  connectTimeoutMs?: number;
  /** Max silence between stream chunks before giving up, ms. */
  idleTimeoutMs?: number;
  userAgent?: string;
}

const DEFAULT_UA = 'sindar';

/** Models that are not chat models and should be hidden from pickers. */
const NON_CHAT =
  /(whisper|tts|embed|embedding|guard|moderation|rerank|audio|transcri|dall-e|image|vision-preview$|aqa|imagen|veo|-live-|native-audio|orpheus|canopylabs|playai|safeguard)/i;

export function isChatModelId(id: string): boolean {
  return !NON_CHAT.test(id);
}

function toOpenAIMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      };
    }
    if (m.role === 'assistant') {
      const out: Record<string, unknown> = {
        role: 'assistant',
        content:
          typeof m.content === 'string'
            ? m.content
            : (m.content?.map((p) => (p.type === 'text' ? p.text : '')).join('') ?? null),
      };
      if (m.toolCalls?.length) {
        out.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments || '{}' },
        }));
        if (!out.content) out.content = null;
      }
      return out;
    }
    if (typeof m.content === 'string' || m.content == null) {
      return { role: m.role, content: m.content ?? '', ...(m.name ? { name: m.name } : {}) };
    }
    return {
      role: m.role,
      content: m.content.map((p) =>
        p.type === 'text'
          ? { type: 'text', text: p.text }
          : { type: 'image_url', image_url: { url: p.url } },
      ),
    };
  });
}

interface PartialCall {
  id?: string;
  name: string;
  args: string;
}

export function createOpenAICompatProvider(
  r: ResolvedProvider,
  opts: HttpProviderOptions = {},
): Provider {
  const fetchImpl: FetchLike = opts.fetch ?? fetch;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 30_000;
  const idleTimeoutMs = opts.idleTimeoutMs ?? 120_000;
  const baseUrl = r.baseUrl ?? '';
  const headers = () =>
    authHeaders(r.apiKey, { 'user-agent': opts.userAgent ?? DEFAULT_UA, ...r.headers });
  let supportsStreamOptions = true;

  async function* chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    if (!baseUrl) throw new ProviderError(`${r.id}: missing baseUrl`, 'invalid_request');
    if (r.requiresKey && !r.apiKey) {
      throw new ProviderError(
        `${r.id}: no API key (${r.apiKeyEnv ?? 'apiKey'})`,
        'auth',
        undefined,
        false,
      );
    }
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.messages),
      stream: true,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
          }
        : {}),
      ...req.extra,
    };

    let res: Response;
    for (let attempt = 0; ; attempt++) {
      if (supportsStreamOptions) body.stream_options = { include_usage: true };
      else delete body.stream_options;
      const t = withTimeout(connectTimeoutMs, signal);
      try {
        res = await fetchImpl(joinUrl(baseUrl, 'chat/completions'), {
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
      if (res.ok) break;
      const e = await httpError(res, r.id);
      // Some servers reject stream_options — retry once without it.
      if (
        attempt === 0 &&
        supportsStreamOptions &&
        res.status === 400 &&
        /stream_options/i.test(e.message)
      ) {
        supportsStreamOptions = false;
        continue;
      }
      throw e;
    }

    const calls = new Map<number, PartialCall>();
    let usage: Usage | undefined;
    let finish: FinishReason | undefined;
    let sawToolCall = false;
    const ac = new AbortController();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => ac.abort(new Error('idle timeout')), idleTimeoutMs);
    };
    const onAbort = () => ac.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    bump();
    try {
      for await (const msg of parseSse(res.body, ac.signal)) {
        if (ac.signal.aborted) break;
        bump();
        if (msg.data === '[DONE]') break;
        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(msg.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (chunk.error) {
          const err = chunk.error as { message?: string; code?: string | number; type?: string };
          throw new ProviderError(`${r.id}: ${err.message ?? JSON.stringify(err)}`, 'server');
        }
        const u = chunk.usage as
          { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
        if (u && (u.prompt_tokens !== undefined || u.completion_tokens !== undefined)) {
          usage = { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 };
        }
        const choices = (chunk.choices as Array<Record<string, unknown>> | undefined) ?? [];
        for (const choice of choices) {
          const delta = (choice.delta ?? choice.message ?? {}) as Record<string, unknown>;
          const reasoning = (delta.reasoning_content ?? delta.reasoning) as string | undefined;
          if (typeof reasoning === 'string' && reasoning)
            yield { type: 'reasoning', delta: reasoning };
          const content = delta.content;
          if (typeof content === 'string' && content) yield { type: 'text', delta: content };
          const tcs = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(tcs)) {
            sawToolCall = true;
            for (const [i, tc] of tcs.entries()) {
              const index = typeof tc.index === 'number' ? tc.index : i;
              const fn = (tc.function ?? {}) as { name?: string; arguments?: string };
              const cur = calls.get(index) ?? { name: '', args: '' };
              if (typeof tc.id === 'string' && tc.id) cur.id = tc.id;
              if (typeof fn.name === 'string' && fn.name) cur.name += fn.name;
              if (typeof fn.arguments === 'string') cur.args += fn.arguments;
              calls.set(index, cur);
            }
          }
          const fr = choice.finish_reason as string | null | undefined;
          if (fr) {
            finish =
              fr === 'tool_calls' || fr === 'function_call'
                ? 'tool_calls'
                : fr === 'length'
                  ? 'length'
                  : 'stop';
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) {
        yield { type: 'done', finishReason: 'cancelled' };
        return;
      }
      if (err instanceof ProviderError) throw err;
      if (ac.signal.aborted) throw new ProviderError(`${r.id}: stream idle timeout`, 'network');
      throw networkError(err, r.id);
    } finally {
      if (idle) clearTimeout(idle);
      signal?.removeEventListener('abort', onAbort);
    }
    // The read loop ends quietly when the body is cancelled: report why instead of passing a
    // truncated answer off as a complete one.
    if (ac.signal.aborted) {
      if (signal?.aborted) {
        yield { type: 'done', finishReason: 'cancelled' };
        return;
      }
      throw new ProviderError(`${r.id}: stream idle timeout`, 'network');
    }

    const toolCalls: ToolCall[] = [...calls.entries()]
      .toSorted((a, b) => a[0] - b[0])
      .map(([i, c]) => ({ id: c.id ?? `call_${i + 1}`, name: c.name, arguments: c.args || '{}' }))
      .filter((c) => c.name);
    for (const call of toolCalls) yield { type: 'tool_call', call };
    if (usage) yield { type: 'usage', usage };
    yield {
      type: 'done',
      finishReason: toolCalls.length || sawToolCall ? 'tool_calls' : (finish ?? 'stop'),
    };
  }

  async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    if (r.models?.length) return r.models.map((id) => ({ id }));
    const t = withTimeout(connectTimeoutMs, signal);
    try {
      const res = await fetchImpl(joinUrl(baseUrl, 'models'), {
        headers: headers(),
        signal: t.signal,
      });
      if (!res.ok) throw await httpError(res, r.id);
      type Item = { id: string; context_length?: number; context_window?: number };
      const j = (await res.json()) as { data?: Item[]; models?: Array<{ name: string }> };
      const items: Item[] = j.data ?? j.models?.map((m) => ({ id: m.name })) ?? [];
      return items
        .map((m) => ({
          id: m.id.replace(/^models\//, ''),
          contextWindow: m.context_length ?? m.context_window,
        }))
        .toSorted((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw networkError(err, r.id, signal?.aborted);
    } finally {
      t.clear();
    }
  }

  async function ping(signal?: AbortSignal): Promise<PingResult> {
    const started = Date.now();
    if (r.requiresKey && !r.apiKey)
      return { ok: false, message: `missing ${r.apiKeyEnv ?? 'API key'}` };
    try {
      await listModels(signal);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      const e = err as ProviderError;
      return { ok: false, message: e.message, latencyMs: Date.now() - started };
    }
  }

  return {
    id: r.id,
    kind: 'openai-compat',
    capabilities: { tools: true, vision: true, streaming: true },
    chat,
    listModels,
    ping,
  };
}
