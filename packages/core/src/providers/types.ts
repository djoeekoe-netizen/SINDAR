import type { ProviderKind } from '../config/schema.js';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
  type: 'text';
  text: string;
}
export interface ImagePart {
  type: 'image';
  /** http(s) URL or data: URL */
  url: string;
}
export type ContentPart = TextPart | ImagePart;
export type Content = string | ContentPart[];

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string of the arguments as produced by the model. */
  arguments: string;
}

export interface ChatMessage {
  role: Role;
  content: Content | null;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12 / OpenAI-compatible). */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  maxTokens?: number;
  /** Provider-specific passthrough options. */
  extra?: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';

export type ProviderErrorCode =
  'auth' | 'rate_limit' | 'network' | 'invalid_request' | 'not_found' | 'server' | 'unknown';

export class ProviderError extends Error {
  /** Suggested wait before retrying (from Retry-After or the error text), in ms. */
  retryAfterMs?: number;
  constructor(
    message: string,
    public readonly code: ProviderErrorCode = 'unknown',
    public readonly status?: number,
    public readonly retryable: boolean = code === 'rate_limit' ||
      code === 'network' ||
      code === 'server',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; finishReason: FinishReason }
  | { type: 'error'; error: ProviderError };

export interface Capabilities {
  tools: boolean;
  vision: boolean;
  streaming: boolean;
}

export interface ModelInfo {
  id: string;
  name?: string;
  contextWindow?: number;
  capabilities?: Partial<Capabilities>;
}

export interface PingResult {
  ok: boolean;
  message?: string;
  latencyMs?: number;
}

export interface Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly capabilities: Capabilities;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent>;
  /** Cheap reachability/auth check (used by `doctor` and onboarding). */
  ping(signal?: AbortSignal): Promise<PingResult>;
}

/** Collect a full response from a stream (handy for tests and non-streaming callers). */
export async function collectChat(events: AsyncIterable<ChatEvent>): Promise<{
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage?: Usage;
  finishReason: FinishReason;
  error?: ProviderError;
}> {
  let text = '';
  let reasoning = '';
  const toolCalls: ToolCall[] = [];
  let usage: Usage | undefined;
  let finishReason: FinishReason = 'stop';
  let error: ProviderError | undefined;
  for await (const ev of events) {
    switch (ev.type) {
      case 'text':
        text += ev.delta;
        break;
      case 'reasoning':
        reasoning += ev.delta;
        break;
      case 'tool_call':
        toolCalls.push(ev.call);
        break;
      case 'usage':
        usage = ev.usage;
        break;
      case 'done':
        finishReason = ev.finishReason;
        break;
      case 'error':
        error = ev.error;
        finishReason = 'error';
        break;
    }
  }
  return { text, reasoning, toolCalls, usage, finishReason, error };
}
