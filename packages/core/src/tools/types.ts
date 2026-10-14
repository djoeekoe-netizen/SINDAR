import type { z, ZodType } from 'zod';
import type { Lang } from '../config/schema.js';
import type { Logger } from '../logger.js';
import type { SindarPaths } from '../paths.js';
import type { PlatformInfo } from '../platform.js';
import type { ToolCall, ToolDefinition } from '../providers/types.js';
import type { MemoryFiles } from '../memory/index.js';
import type { SkillStore } from '../skills/index.js';
import type { SessionStore } from '../agent/sessions.js';

export type Risk = 'read' | 'write' | 'exec' | 'network';

export interface ToolResult {
  content: string;
  isError?: boolean;
  /** Structured extras for UIs (never sent to the model). */
  meta?: Record<string, unknown>;
}

export interface ToolContext {
  cwd: string;
  workspace: string;
  home: string;
  paths: SindarPaths;
  env: Record<string, string | undefined>;
  platform: PlatformInfo;
  lang: Lang;
  sessionId?: string;
  signal?: AbortSignal;
  logger: Logger;
  limits: { maxOutputChars: number; timeoutMs: number };
  /** Persist an oversized output; returns the file path to mention to the model. */
  saveOverflow(name: string, text: string): string;
  /** Live progress line for UIs (optional). */
  onProgress?(line: string): void;
  /** Runtime services for the learning-loop tools (memory, skills, session search). */
  services?: ToolServices;
}

export interface ToolServices {
  memory?: MemoryFiles;
  skills?: SkillStore;
  sessions?: Pick<SessionStore, 'search' | 'transcript' | 'find'>;
  /** config `skills.autoCreate` — decides whether skill_manager needs approval. */
  skillsMode?: 'ask' | 'auto' | 'off';
}

export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  risk: Risk;
  parameters: ZodType<TArgs>;
  /** Toolset this tool belongs to (files, terminal, web, …). */
  toolset: string;
  /** One-line human summary of a call for approval prompts/logs. */
  summarize?(args: TArgs): string;
  /** Refine the risk for specific arguments (e.g. write outside workspace → 'write-outside'). */
  classify?(args: TArgs, ctx: ToolContext): ToolRiskDetail;
  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolRiskDetail {
  risk: Risk;
  /** True when the operation touches paths outside cwd/workspace. */
  outsideWorkspace?: boolean;
  /** Program name for exec risk (used by allowlists). */
  program?: string;
  /** Hard floor hit — must always be denied. */
  forbidden?: string;
}

export interface ToolRegistry {
  list(): Tool[];
  get(name: string): Tool | undefined;
  definitions(): ToolDefinition[];
  /** Parse + validate the raw arguments of a model tool call. */
  parseArgs(
    call: ToolCall,
  ): { ok: true; tool: Tool; args: unknown } | { ok: false; tool?: Tool; error: string };
  execute(tool: Tool, args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool<S extends ZodType>(
  tool: Omit<Tool<z.output<S>>, 'parameters'> & { parameters: S },
): Tool<z.output<S>> {
  return tool as Tool<z.output<S>>;
}
