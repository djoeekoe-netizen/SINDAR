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

/**
 * Per-request token caps that free tiers enforce on top of the context window
 * (Groq "tokens per minute": a single request above it is rejected with HTTP 413).
 * Starting points only — the real limit is learned from the provider's error text.
 */
const INPUT_BUDGETS: Array<[provider: RegExp, model: RegExp, tokens: number]> = [
  [/^groq$/i, /gpt-oss/i, 8_000],
  [/^groq$/i, /llama-3\.3-70b/i, 12_000],
  [/^groq$/i, /llama-3\.1-8b/i, 6_000],
  [/^groq$/i, /llama-4-scout/i, 30_000],
  [/^groq$/i, /llama-4-maverick|qwen3|deepseek|allam/i, 6_000],
  [/^groq$/i, /kimi-k2/i, 10_000],
  [/^groq$/i, /gemma/i, 15_000],
  [/^groq$/i, /compound/i, 70_000],
  [/^groq$/i, /.*/, 8_000],
];

const MINUTE_MS = 60_000;

export function guessInputBudget(providerId: string, model: string): number | undefined {
  for (const [p, m, n] of INPUT_BUDGETS) if (p.test(providerId) && m.test(model)) return n;
  return undefined;
}

/** What the loop may spend on one request for a model: budget + how far off our token estimate is. */
export interface RequestBudget {
  /** Hard cap for one request in provider-counted tokens, or undefined when only the context window applies. */
  tokens?: number;
  /** Multiply our rough estimate by this to approximate the provider's count (learned from usage). */
  scale: number;
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

  private readonly learnedBudgets = new Map<string, number>();
  private readonly scales = new Map<string, number>();
  private readonly minuteLimits = new Map<string, number>();
  private readonly minuteLog = new Map<string, Array<{ at: number; tokens: number }>>();

  /**
   * Tokens-per-minute budget of `provider:model`: learned from a 429 that quoted it, else the
   * free-tier table (on Groq the per-request cap *is* the TPM). Undefined = no known minute cap.
   */
  minuteLimit(ref: string): number | undefined {
    const learned = this.minuteLimits.get(ref);
    if (learned !== undefined) return learned;
    const { provider: providerId = '', model } = parseModelRef(ref);
    return guessInputBudget(providerId, model);
  }

  private window(ref: string, now: number): Array<{ at: number; tokens: number }> {
    const list = (this.minuteLog.get(ref) ?? []).filter((e) => now - e.at < MINUTE_MS);
    this.minuteLog.set(ref, list);
    return list;
  }

  /** Record tokens a request consumed (prompt + completion) so the next one can be paced. */
  noteUsage(ref: string, tokens: number, now: number = Date.now()): void {
    if (!(tokens > 0)) return;
    this.window(ref, now).push({ at: now, tokens });
  }

  /** Tokens counted against `ref` in the current minute. */
  minuteUsed(ref: string, now: number = Date.now()): number {
    return this.window(ref, now).reduce((sum, e) => sum + e.tokens, 0);
  }

  /**
   * A per-minute 429: trust the provider's numbers — remember the limit and align our window so
   * that `used` tokens expire exactly when it says we may retry.
   */
  noteRateLimit(
    ref: string,
    info: { limit?: number; used?: number; retryAfterMs?: number },
    now: number = Date.now(),
  ): void {
    if (info.limit && info.limit > 0) this.minuteLimits.set(ref, info.limit);
    if (info.used !== undefined && info.used > 0) {
      const expiresIn = Math.min(MINUTE_MS, Math.max(1000, info.retryAfterMs ?? MINUTE_MS));
      this.minuteLog.set(ref, [{ at: now - (MINUTE_MS - expiresIn), tokens: info.used }]);
    }
  }

  /**
   * Milliseconds to wait before a request of `tokens` fits in this minute's budget (0 = now).
   * A request that could never fit returns 0 — that is the per-request cap's business.
   */
  minuteWait(ref: string, tokens: number, now: number = Date.now()): number {
    const limit = this.minuteLimit(ref);
    if (!limit || tokens >= limit) return 0;
    const list = this.window(ref, now);
    let used = list.reduce((sum, e) => sum + e.tokens, 0);
    if (used + tokens <= limit) return 0;
    for (const e of list) {
      used -= e.tokens;
      if (used + tokens <= limit) return Math.max(0, e.at + MINUTE_MS - now) + 250;
    }
    return MINUTE_MS;
  }

  /** Per-request cap for `provider:model` (config override > learned from errors > known free tiers). */
  budget(ref: string): RequestBudget {
    const { provider: providerId = '', model } = parseModelRef(ref);
    const learned = this.learnedBudgets.get(ref);
    const configured = this.config.agent.inputBudget;
    const guessed = guessInputBudget(providerId, model);
    const tokens =
      learned !== undefined
        ? configured !== undefined
          ? Math.min(learned, configured)
          : learned
        : (configured ?? guessed);
    return { tokens, scale: this.scales.get(ref) ?? 1 };
  }

  /**
   * The provider rejected a request as too large: remember a cap below what it quoted
   * (or 80% of what we sent when it did not say). Returns the new cap.
   */
  noteTooLarge(
    ref: string,
    limit: number | undefined,
    requested: number | undefined,
    estimated: number,
  ): number {
    if (requested && estimated > 0) this.noteScale(ref, requested / estimated);
    const current = this.budget(ref).tokens;
    let cap = limit ? Math.floor(limit * 0.9) : Math.floor((requested ?? estimated) * 0.8);
    if (current !== undefined && current <= cap) cap = Math.floor(current * 0.8);
    cap = Math.max(1_000, cap);
    this.learnedBudgets.set(ref, cap);
    return cap;
  }

  /** Calibrate the estimate from a real `prompt_tokens` count (exponential moving average). */
  calibrate(ref: string, estimated: number, actual: number): void {
    if (!(estimated > 0) || !(actual > 0)) return;
    this.noteScale(ref, actual / estimated);
  }

  private noteScale(ref: string, ratio: number): void {
    const clamped = Math.min(4, Math.max(0.4, ratio));
    const prev = this.scales.get(ref);
    this.scales.set(ref, prev === undefined ? clamped : prev * 0.5 + clamped * 0.5);
  }
}
