import { DOCUMENT_TOOLS } from './documents.js';
import { FILE_TOOLS } from './files.js';
import { memory, sessionSearch } from './memory.js';
import { createToolRegistry } from './registry.js';
import { skill, skillManager } from './skills.js';
import { TERMINAL_TOOLS } from './terminal.js';
import type { Tool, ToolRegistry } from './types.js';
import { WEB_TOOLS } from './web.js';

export * from './types.js';
export * from './registry.js';
export * from './paths.js';
export * from './files.js';
export * from './documents.js';
export * from './terminal.js';
export * from './web.js';
export * from './memory.js';
export * from './skills.js';

export const MEMORY_TOOLS: Tool[] = [memory as Tool, sessionSearch as Tool];
export const SKILL_TOOLS: Tool[] = [skill as Tool, skillManager as Tool];

export const TOOLSETS: Record<string, Tool[]> = {
  // make_pdf lives in `files` so existing configs (explicit toolset lists) get it without migration.
  files: [...FILE_TOOLS, ...DOCUMENT_TOOLS],
  terminal: TERMINAL_TOOLS,
  web: WEB_TOOLS,
  memory: MEMORY_TOOLS,
  skills: SKILL_TOOLS,
};

/** Build a registry from toolset names (unknown names are ignored; extra tools can be appended). */
export function toolsForToolsets(names: readonly string[], extra: Tool[] = []): ToolRegistry {
  const tools: Tool[] = [];
  for (const n of names) for (const t of TOOLSETS[n] ?? []) tools.push(t);
  return createToolRegistry([...tools, ...extra]);
}
