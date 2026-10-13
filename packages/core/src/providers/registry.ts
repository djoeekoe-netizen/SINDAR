import type { Config } from '../config/schema.js';
import { createAnthropicProvider } from './anthropic.js';
import { createMockProvider, type MockProviderOptions } from './mock.js';
import { formatModelRef, parseModelRef, type ModelRef } from './model-ref.js';
import { createOpenAICompatProvider, type HttpProviderOptions } from './openai-compat.js';
import { resolveProvider, type ResolvedProvider } from './resolve.js';
import { getProviderTemplate } from './templates.js';
import { ProviderError, type Provider } from './types.js';

export interface ModelTarget {
  provider: Provider;
  providerId: string;
  model: string;
  ref: string;
  resolved: ResolvedProvider;
}

export interface ProviderRegistryOptions extends HttpProviderOptions {
  mock?: MockProviderOptions;
  /** Inject ready-made providers (tests). */
  instances?: Record<string, Provider>;
}

export function instantiateProvider(
  r: ResolvedProvider,
  opts: ProviderRegistryOptions = {},
): Provider {
  switch (r.kind) {
    case 'mock':
      return createMockProvider(opts.mock);
    case 'anthropic':
      return createAnthropicProvider(r, opts);
    case 'openai-compat':
    default:
      return createOpenAICompatProvider(r, opts);
  }
}

/** Known context windows (tokens) for popular free models; used for compression thresholds. */
const CONTEXT_WINDOWS: Array<[RegExp, number]> = [
  [/gemini-2\.5|gemini-2\.0|gemini-1\.5/i, 1_000_000],
  [/llama-3\.3-70b|llama-3\.1|llama-4/i, 128_000],
  [/qwen3|qwen-3|qwq/i, 128_000],
  [/gpt-4o|gpt-4\.1|gpt-5|o[134]-/i, 128_000],
  [/claude/i, 200_000],
  [/mistral-small|mistral-large|magistral|devstral/i, 128_000],
  [/deepseek/i, 64_000],
  [/grok/i, 128_000],
  [/kimi-k2|moonshot/i, 128_000],
  [/gemma-?3|gemma3/i, 32_000],
  [/llama3\.2|llama-3\.2|phi-?3|phi-?4/i, 16_000],
];

export function guessContextWindow(model: string, fallback = 32_000): number {
  for (const [re, n] of CONTEXT_WINDOWS) if (re.test(model)) return n;
  return fallback;
}

/** Resolves `provider:model` refs into live Provider instances (cached per provider id). */
export class ProviderRegistry {
  private readonly cache = new Map<string, Provider>();

  constructor(
    private readonly config: Config,
    private readonly env: Record<string, string | undefined>,
    private readonly opts: ProviderRegistryOptions = {},
  ) {
    for (const [id, p] of Object.entries(opts.instances ?? {})) this.cache.set(id, p);
  }

  resolve(id: string): ResolvedProvider | undefined {
    return resolveProvider(id, this.config.providers[id], this.env);
  }

  /** Instantiate (or reuse) the provider with this id. Throws a ProviderError when unusable. */
  get(id: string): Provider {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const r = this.resolve(id);
    if (!r) {
      throw new ProviderError(
        `unknown provider "${id}" — see \`sindar model\` for the list`,
        'invalid_request',
        undefined,
        false,
      );
    }
    if (!r.enabled)
      throw new ProviderError(
        `provider "${id}" is disabled in config.yaml`,
        'invalid_request',
        undefined,
        false,
      );
    if (!r.configured) {
      const hint = r.signupUrl ? ` — get a free key: ${r.signupUrl}` : '';
      throw new ProviderError(
        `provider "${id}" has no API key (${r.apiKeyEnv ?? 'apiKey'})${hint}`,
        'auth',
        undefined,
        false,
      );
    }
    const p = instantiateProvider(r, this.opts);
    this.cache.set(id, p);
    return p;
  }

  /** Parse a ref like `groq:llama-3.3-70b-versatile`; a bare model name needs a default provider. */
  parse(ref: string): Required<ModelRef> {
    const m = parseModelRef(ref);
    if (m.provider) return { provider: m.provider, model: m.model };
    const def = parseModelRef(this.config.model.default);
    if (def.provider && def.provider !== 'mock') return { provider: def.provider, model: m.model };
    const tplMatch = getProviderTemplate(m.model);
    if (tplMatch)
      throw new ProviderError(
        `"${ref}" is a provider — use ${ref}:<model>`,
        'invalid_request',
        undefined,
        false,
      );
    throw new ProviderError(
      `model ref "${ref}" must look like provider:model (e.g. groq:llama-3.3-70b-versatile)`,
      'invalid_request',
      undefined,
      false,
    );
  }

  target(ref: string): ModelTarget {
    const { provider: providerId, model } = this.parse(ref);
    const provider = this.get(providerId);
    const resolved = this.resolve(providerId)!;
    return {
      provider,
      providerId,
      model,
      ref: formatModelRef({ provider: providerId, model }),
      resolved,
    };
  }

  /** Default target followed by configured fallbacks (refs only; instantiation happens lazily). */
  candidates(primary?: string): string[] {
    const list = [primary ?? this.config.model.default, ...this.config.model.fallbacks];
    return [...new Set(list.filter(Boolean))];
  }

  contextWindow(model: string): number {
    return guessContextWindow(model, this.config.agent.contextWindow ?? 32_000);
  }
}
