import { z } from 'zod';

export const ProviderKindSchema = z.enum(['openai-compat', 'anthropic', 'mock']);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const ProviderConfigSchema = z.object({
  /** Omitted → taken from the built-in template with the same id. */
  type: ProviderKindSchema.optional(),
  baseUrl: z.string().optional(),
  /** Name of the environment variable holding the API key. */
  apiKeyEnv: z.string().optional(),
  /** Inline key — discouraged; prefer `.env`. */
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /** Optional pinned model list (skips remote discovery). */
  models: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ApprovalModeSchema = z.enum(['ask', 'allowlist', 'yolo']);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const LangSchema = z.enum(['ar', 'en']);
export type Lang = z.infer<typeof LangSchema>;

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  model: z
    .object({
      default: z.string().min(1).default('mock:echo'),
      fallbacks: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  agent: z
    .object({
      approvalMode: ApprovalModeSchema.default('ask'),
      /** Defaults to `<home>/workspace` when omitted. */
      workspace: z.string().optional(),
      maxIterations: z.number().int().positive().max(500).default(50),
      /** Tool groups exposed to the model. */
      toolsets: z.array(z.string()).default(['files', 'terminal', 'web', 'memory', 'skills']),
      /** Programs that may run without approval in `allowlist` mode (first word of the command). */
      allowlist: z
        .array(z.string())
        .default([
          'ls',
          'cat',
          'head',
          'tail',
          'wc',
          'pwd',
          'echo',
          'grep',
          'rg',
          'find',
          'git',
          'node',
          'npm',
          'pnpm',
          'python3',
          'python',
          'date',
          'uname',
          'which',
        ]),
      /** Context window override when the model is unknown (tokens). */
      contextWindow: z.number().int().positive().optional(),
      /** Tool output beyond this is truncated (full output saved to a file). */
      maxToolOutputChars: z.number().int().positive().default(16_000),
      toolTimeoutS: z.number().int().positive().max(3600).default(120),
      temperature: z.number().min(0).max(2).optional(),
    })
    .prefault({}),
  memory: z
    .object({
      /** Remind the model to save memories after this many user turns without a memory write (0 = off). */
      nudgeEvery: z.number().int().min(0).max(100).default(8),
      /** Size caps for MEMORY.md / USER.md (chars) — the model must consolidate beyond this. */
      maxChars: z.number().int().positive().default(12_000),
      userMaxChars: z.number().int().positive().default(6_000),
    })
    .prefault({}),
  skills: z
    .object({
      /** ask = propose and wait for the user · auto = create silently after complex tasks · off. */
      autoCreate: z.enum(['ask', 'auto', 'off']).default('ask'),
      /** A turn with at least this many tool calls counts as a complex task worth a skill. */
      reflectAfterToolCalls: z.number().int().min(1).default(6),
      /** Extra skill directories (besides ~/.sindar/skills). */
      extraDirs: z.array(z.string()).default([]),
    })
    .prefault({}),
  gateway: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().min(1).max(65535).default(18789),
    })
    .prefault({}),
  ui: z
    .object({
      language: LangSchema.default('ar'),
      theme: z.enum(['dark', 'light', 'system']).default('dark'),
    })
    .prefault({}),
  logging: z
    .object({
      level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      file: z.boolean().default(true),
    })
    .prefault({}),
  channels: z
    .object({
      telegram: z
        .object({
          enabled: z.boolean().default(false),
          /** Name of the environment variable (in `.env`) holding the bot token from @BotFather. */
          tokenEnv: z.string().default('TELEGRAM_BOT_TOKEN'),
          /** Chat ids allowed without pairing (besides the ones approved with a code). */
          allowFrom: z.array(z.number().int()).default([]),
          /** Edit the reply while the model streams (false = one message at the end). */
          streaming: z.boolean().default(true),
          /** Groups: reply only when mentioned/replied-to, to everything, or never. */
          groups: z.enum(['mention', 'all', 'off']).default('mention'),
        })
        .prefault({}),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;
