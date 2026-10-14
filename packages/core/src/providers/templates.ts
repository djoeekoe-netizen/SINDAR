import type { ProviderKind } from '../config/schema.js';

/** How the provider fits the "free first" principle (ADR-09). */
export type FreeTier = 'local' | 'free-tier' | 'paid' | 'test';

export interface ProviderTemplate {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  /** Env var that holds the key; `requiresKey: false` for local servers. */
  apiKeyEnv?: string;
  requiresKey: boolean;
  free: FreeTier;
  signupUrl?: string;
  /** Suggested starting models (cheap/free first). */
  suggestedModels?: string[];
  notes?: { ar: string; en: string };
}

export const PROVIDER_TEMPLATES: readonly ProviderTemplate[] = [
  // ---------- local (free, private) ----------
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'openai-compat',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    requiresKey: false,
    free: 'local',
    suggestedModels: ['qwen3:8b', 'llama3.2:3b', 'gemma3:4b'],
    notes: {
      ar: 'يعمل على جهازك بلا إنترنت. يحتاج ذاكرة 8GB+',
      en: 'Runs on your device offline. Needs 8GB+ RAM',
    },
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'openai-compat',
    baseUrl: 'http://127.0.0.1:1234/v1',
    requiresKey: false,
    free: 'local',
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp server',
    kind: 'openai-compat',
    baseUrl: 'http://127.0.0.1:8080/v1',
    requiresKey: false,
    free: 'local',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    kind: 'openai-compat',
    baseUrl: 'http://127.0.0.1:8000/v1',
    requiresKey: false,
    free: 'local',
  },

  // ---------- cloud with a free tier (limits change — verify at signup) ----------
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compat',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    requiresKey: true,
    free: 'free-tier',
    signupUrl: 'https://console.groq.com/keys',
    suggestedModels: [
      'openai/gpt-oss-120b',
      'llama-3.3-70b-versatile',
      'qwen/qwen3-32b',
      'openai/gpt-oss-20b',
      'llama-3.1-8b-instant',
    ],
    notes: {
      ar: 'سريع جداً، طبقة مجانية سخية — الأنسب للجوال',
      en: 'Very fast, generous free tier — best for phones',
    },
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'openai-compat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    requiresKey: true,
    free: 'free-tier',
    signupUrl: 'https://aistudio.google.com/apikey',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    notes: {
      ar: 'طبقة مجانية بحدود يومية، نافذة سياق كبيرة',
      en: 'Free tier with daily limits, large context window',
    },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compat',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    requiresKey: true,
    free: 'free-tier',
    signupUrl: 'https://openrouter.ai/keys',
    suggestedModels: ['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-coder:free'],
    notes: {
      ar: 'مئات النماذج بمفتاح واحد، منها نماذج :free',
      en: 'Hundreds of models behind one key, including :free ones',
    },
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compat',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    requiresKey: true,
    free: 'free-tier',
    signupUrl: 'https://console.mistral.ai/',
    suggestedModels: ['mistral-small-latest'],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    kind: 'openai-compat',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    requiresKey: true,
    free: 'free-tier',
    signupUrl: 'https://cloud.cerebras.ai/',
    suggestedModels: ['llama-3.3-70b'],
  },
  {
    id: 'github',
    name: 'GitHub Models',
    kind: 'openai-compat',
    baseUrl: 'https://models.github.ai/inference',
    apiKeyEnv: 'GITHUB_TOKEN',
    requiresKey: true,
    free: 'free-tier',
    signupUrl: 'https://github.com/settings/tokens',
    suggestedModels: ['openai/gpt-4o-mini'],
  },

  // ---------- paid (optional) ----------
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compat',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    requiresKey: true,
    free: 'paid',
    signupUrl: 'https://platform.openai.com/api-keys',
    suggestedModels: ['gpt-4o-mini'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    requiresKey: true,
    free: 'paid',
    signupUrl: 'https://console.anthropic.com/',
    suggestedModels: ['claude-sonnet-4-5'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    requiresKey: true,
    free: 'paid',
    suggestedModels: ['deepseek-chat'],
  },
  {
    id: 'xai',
    name: 'xAI',
    kind: 'openai-compat',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    requiresKey: true,
    free: 'paid',
    suggestedModels: ['grok-4-fast'],
  },
  {
    id: 'together',
    name: 'Together AI',
    kind: 'openai-compat',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    requiresKey: true,
    free: 'paid',
  },

  // ---------- testing ----------
  {
    id: 'mock',
    name: 'Mock (testing)',
    kind: 'mock',
    requiresKey: false,
    free: 'test',
    suggestedModels: ['echo'],
  },
];

export function getProviderTemplate(id: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((t) => t.id === id);
}
