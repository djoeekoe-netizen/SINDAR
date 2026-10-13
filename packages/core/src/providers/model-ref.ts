export interface ModelRef {
  provider?: string;
  model: string;
}

/**
 * `provider:model` — the model part may itself contain colons (Ollama tags):
 *   "groq:llama-3.3-70b-versatile" → { provider: "groq", model: "llama-3.3-70b-versatile" }
 *   "ollama:qwen3:8b"              → { provider: "ollama", model: "qwen3:8b" }
 *   "gpt-4o-mini"                  → { model: "gpt-4o-mini" }
 */
export function parseModelRef(ref: string): ModelRef {
  const s = ref.trim();
  const i = s.indexOf(':');
  if (i <= 0) return { model: s };
  const provider = s.slice(0, i);
  const model = s.slice(i + 1);
  // Guard against URLs or Windows paths accidentally passed as a model.
  if (!/^[a-z0-9_-]+$/i.test(provider) || model.startsWith('//')) return { model: s };
  return { provider, model };
}

export function formatModelRef(ref: ModelRef): string {
  return ref.provider ? `${ref.provider}:${ref.model}` : ref.model;
}
