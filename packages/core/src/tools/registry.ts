import { z } from 'zod';
import type { ToolCall, ToolDefinition } from '../providers/types.js';
import type { Tool, ToolRegistry, ToolResult } from './types.js';

/** zod → JSON Schema trimmed for LLM tool definitions. */
export function toolParametersSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<
    string,
    unknown
  >;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === '$schema' || k === 'additionalProperties') continue;
        if ((k === 'minimum' || k === 'maximum') && Math.abs(val as number) > 1e15) continue;
        o[k] = strip(val);
      }
      return o;
    }
    return v;
  };
  const out = strip(raw) as Record<string, unknown>;
  if (out.type !== 'object') return { type: 'object', properties: {}, ...out };
  if (!out.properties) out.properties = {};
  return out;
}

export function truncateOutput(text: string, max: number, overflowPath?: string): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  const note = `\n\n…[truncated ${text.length - max} chars${overflowPath ? `; full output saved to ${overflowPath}` : ''}]…\n\n`;
  return text.slice(0, head) + note + text.slice(text.length - tail);
}

export function createToolRegistry(tools: Tool[]): ToolRegistry {
  const byName = new Map<string, Tool>();
  for (const t of tools) {
    if (byName.has(t.name)) throw new Error(`duplicate tool: ${t.name}`);
    byName.set(t.name, t);
  }
  const definitions: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toolParametersSchema(t.parameters),
  }));

  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
    definitions: () => definitions,
    parseArgs(call: ToolCall) {
      const tool = byName.get(call.name);
      if (!tool)
        return {
          ok: false,
          error: `unknown tool "${call.name}". Available: ${[...byName.keys()].join(', ')}`,
        };
      let raw: unknown = {};
      const text = (call.arguments ?? '').trim();
      if (text) {
        try {
          raw = JSON.parse(text);
        } catch (e) {
          return {
            ok: false,
            tool,
            error: `arguments are not valid JSON: ${(e as Error).message}`,
          };
        }
      }
      const parsed = tool.parameters.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        return { ok: false, tool, error: `invalid arguments for ${tool.name}: ${issues}` };
      }
      return { ok: true, tool, args: parsed.data };
    },
    async execute(tool, args, ctx): Promise<ToolResult> {
      const started = Date.now();
      try {
        const res = await tool.execute(args, ctx);
        let content = res.content ?? '';
        if (content.length > ctx.limits.maxOutputChars) {
          const file = ctx.saveOverflow(tool.name, content);
          content = truncateOutput(content, ctx.limits.maxOutputChars, file);
        }
        return { ...res, content, meta: { ...res.meta, ms: Date.now() - started } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `error: ${msg}`, isError: true, meta: { ms: Date.now() - started } };
      }
    },
  };
}
