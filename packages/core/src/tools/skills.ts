import { z } from 'zod';
import { SkillError, SkillStore } from '../skills/index.js';
import { defineTool, type ToolContext, type ToolRiskDetail } from './types.js';

function storeFor(ctx: ToolContext): SkillStore {
  return ctx.services?.skills ?? new SkillStore({ user: ctx.paths.skills });
}

export const skill = defineTool({
  name: 'skill',
  toolset: 'skills',
  risk: 'read',
  description: [
    'Read one of your skills (reusable step-by-step procedures) before doing a task that matches it.',
    'The system prompt lists skill names + descriptions; action "read" returns the full instructions,',
    'action "list" shows all skills. Follow the skill, then improve it with skill_manager if a step was wrong.',
  ].join(' '),
  parameters: z.object({
    action: z.enum(['read', 'list']).default('read'),
    name: z.string().optional().describe('Skill name (for read)'),
  }),
  summarize: (a) => (a.action === 'list' ? 'list skills' : `read skill ${a.name ?? ''}`),
  async execute(args, ctx) {
    const store = storeFor(ctx);
    if (args.action === 'list') {
      const all = store.list();
      if (!all.length)
        return { content: 'No skills yet. Create one with skill_manager after a reusable task.' };
      return {
        content: all
          .map((s) => `- ${s.name} (${s.source}, v${s.version}) — ${s.description}`)
          .join('\n'),
      };
    }
    if (!args.name) return { content: 'error: name is required for read', isError: true };
    const s = store.get(args.name);
    if (!s) {
      const names = store
        .list()
        .map((x) => x.name)
        .join(', ');
      return {
        content: `error: no skill named "${args.name}". Available: ${names || '(none)'}`,
        isError: true,
      };
    }
    const extras = s.files.length
      ? `\n\nFiles in this skill (read with read_file, run scripts only via terminal):\n${s.files.map((f) => `- ${s.dir}/${f}`).join('\n')}`
      : '';
    return {
      content: `# Skill: ${s.name} (v${s.version}, ${s.source})\n${s.description}\n\n${s.body}${extras}\n\n(If a step fails and you find the fix, call skill_manager update with a changelog note.)`,
    };
  },
});

function classifyManager(args: { action: string }, ctx: ToolContext): ToolRiskDetail {
  const mode = ctx.services?.skillsMode ?? 'ask';
  if (mode === 'off')
    return { risk: 'write', forbidden: 'skill creation is disabled (skills.autoCreate = off)' };
  // ask → goes through the approval card; auto → silent (like a workspace write).
  void args;
  return { risk: 'write', outsideWorkspace: mode === 'ask' };
}

export const skillManager = defineTool({
  name: 'skill_manager',
  toolset: 'skills',
  risk: 'write',
  description: [
    'Create, update or remove a skill (a reusable procedure saved as SKILL.md).',
    'Create one after finishing a multi-step task that is likely to recur — capture the exact steps, commands,',
    'paths and pitfalls so next time takes fewer steps. Update an existing skill when a step failed and you fixed it',
    '(pass a short changelog). Names: letters/digits/-/_ only, e.g. "weekly-report".',
  ].join(' '),
  parameters: z.object({
    action: z.enum(['create', 'update', 'remove']),
    name: z.string().min(1).max(64),
    description: z.string().max(300).optional().describe('One line: when to use this skill'),
    content: z
      .string()
      .max(16_000)
      .optional()
      .describe('Markdown body: Steps, Commands, Pitfalls (no frontmatter — it is generated)'),
    tags: z.array(z.string().max(30)).max(8).optional(),
    changelog: z.string().max(200).optional().describe('What changed and why (update)'),
  }),
  summarize: (a) => `${a.action} skill ${a.name}`,
  classify: classifyManager,
  async execute(args, ctx) {
    const store = storeFor(ctx);
    try {
      switch (args.action) {
        case 'create': {
          if (!args.description || !args.content)
            return {
              content: 'error: description and content are required for create',
              isError: true,
            };
          const s = store.create({
            name: args.name,
            description: args.description,
            body: args.content,
            tags: args.tags,
          });
          return {
            content: `skill "${s.name}" created at ${s.file} (${s.chars} chars). It will appear in your skills index from the next turn.`,
          };
        }
        case 'update': {
          const s = store.update(args.name, {
            description: args.description,
            body: args.content,
            tags: args.tags,
            changelog: args.changelog,
          });
          return { content: `skill "${s.name}" updated → v${s.version} (${s.chars} chars)` };
        }
        case 'remove': {
          store.remove(args.name);
          return { content: `skill "${args.name}" removed` };
        }
      }
    } catch (err) {
      if (err instanceof SkillError) return { content: `error: ${err.message}`, isError: true };
      throw err;
    }
    return { content: 'error: unknown action', isError: true };
  },
});
