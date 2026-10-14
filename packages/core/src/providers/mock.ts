import {
  type ChatEvent,
  type ChatRequest,
  type Provider,
  type ToolCall,
  type Usage,
} from './types.js';

export interface MockTurn {
  text?: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  /** Simulate a provider failure for this turn. */
  error?: { message: string; code?: 'auth' | 'rate_limit' | 'network' | 'server' };
}

export interface MockProviderOptions {
  /** Scripted turns consumed in order; after they run out the echo behaviour applies. */
  script?: MockTurn[];
  chunkSize?: number;
  /** Artificial delay between chunks (ms) to exercise streaming UIs. */
  delayMs?: number;
}

export interface MockProvider extends Provider {
  /** Every request received, for assertions in tests. */
  readonly requests: ChatRequest[];
}

function lastUserText(req: ChatRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role === 'user') {
      if (typeof m.content === 'string') return m.content;
      return (m.content ?? []).map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ');
    }
    if (m.role === 'tool')
      return `tool:${m.name ?? ''}:${typeof m.content === 'string' ? m.content : ''}`;
  }
  return '';
}

const estimateTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

/**
 * Deterministic provider for tests and offline development.
 *
 * Echo mode: replies with the last user message. A message of the form
 * `!tool <name> <json>` makes it emit a tool call instead (e.g. `!tool read_file {"path":"a.txt"}`),
 * and a tool result message is acknowledged with `tool-result:<name>:<content>`.
 */
export function createMockProvider(opts: MockProviderOptions = {}): MockProvider {
  const script = [...(opts.script ?? [])];
  const chunkSize = opts.chunkSize ?? 8;
  const requests: ChatRequest[] = [];

  async function* stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    requests.push(req);
    const turn: MockTurn = script.length ? script.shift()! : echoTurn(req);

    if (turn.error) {
      const { ProviderError } = await import('./types.js');
      const { parseRetryAfter } = await import('./http.js');
      const error = new ProviderError(turn.error.message, turn.error.code ?? 'server');
      const wait = parseRetryAfter(null, turn.error.message);
      if (wait !== undefined) error.retryAfterMs = wait;
      yield { type: 'error', error };
      yield { type: 'done', finishReason: 'error' };
      return;
    }

    const text = turn.text ?? '';
    for (let i = 0; i < text.length; i += chunkSize) {
      if (signal?.aborted) {
        yield { type: 'done', finishReason: 'cancelled' };
        return;
      }
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      yield { type: 'text', delta: text.slice(i, i + chunkSize) };
    }
    for (const call of turn.toolCalls ?? []) yield { type: 'tool_call', call };

    const inputTokens = req.messages.reduce(
      (n, m) =>
        n +
        estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')),
      0,
    );
    yield {
      type: 'usage',
      usage: turn.usage ?? { inputTokens, outputTokens: estimateTokens(text) },
    };
    yield { type: 'done', finishReason: turn.toolCalls?.length ? 'tool_calls' : 'stop' };
  }

  function echoTurn(req: ChatRequest): MockTurn {
    const last = lastUserText(req);
    const m = /^!tool\s+([a-z0-9_-]+)\s*(\{.*\})?\s*$/is.exec(last);
    if (m) {
      return {
        text: '',
        toolCalls: [{ id: `call_${requests.length}`, name: m[1]!, arguments: m[2] ?? '{}' }],
      };
    }
    if (last.startsWith('tool:')) {
      const [, name = '', ...rest] = last.split(':');
      return { text: `tool-result:${name}:${rest.join(':')}` };
    }
    return { text: last ? `echo: ${last}` : 'echo: (empty)' };
  }

  return {
    id: 'mock',
    kind: 'mock',
    capabilities: { tools: true, vision: false, streaming: true },
    requests,
    listModels: async () => [{ id: 'echo', name: 'Mock Echo', contextWindow: 128_000 }],
    chat: (req, signal) => stream(req, signal),
    ping: async () => ({ ok: true, message: 'mock', latencyMs: 0 }),
  };
}
