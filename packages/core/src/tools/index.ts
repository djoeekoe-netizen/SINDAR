import { FILE_TOOLS } from './files.js';
import { createToolRegistry } from './registry.js';
import { TERMINAL_TOOLS } from './terminal.js';
import type { Tool, ToolRegistry } from './types.js';
import { WEB_TOOLS } from './web.js';

export * from './types.js';
export * from './registry.js';
export * from './paths.js';
export * from './files.js';
export * from './terminal.js';
export * from './web.js';

export const TOOLSETS: Record<string, Tool[]> = {
  files: FILE_TOOLS,
  terminal: TERMINAL_TOOLS,
  web: WEB_TOOLS,
};

/** Build a registry from toolset names (unknown names are ignored; extra tools can be appended). */
export function toolsForToolsets(names: readonly string[], extra: Tool[] = []): ToolRegistry {
  const tools: Tool[] = [];
  for (const n of names) for (const t of TOOLSETS[n] ?? []) tools.push(t);
  return createToolRegistry([...tools, ...extra]);
}
