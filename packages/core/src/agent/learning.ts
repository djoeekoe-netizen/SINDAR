import type { Config } from '../config/schema.js';
import type { MemoryFiles } from '../memory/index.js';
import type { Provider, Usage } from '../providers/types.js';
import { isValidSkillName, type SkillStore } from '../skills/index.js';

/**
 * The learning loop (PLAN §11): what the system prompt says about memory and skills,
 * the periodic memory nudge, and the optional post-task skill reflection.
 */

export interface LearningSectionsInput {
  config: Config;
  memory: MemoryFiles;
  skills: SkillStore;
  toolNames: Set<string>;
  turnsSinceMemorySave: number;
}

export function learningSections(input: LearningSectionsInput): string[] {
  const { config, toolNames } = input;
  const out: string[] = [];

  if (toolNames.has('memory')) {
    const m = input.memory.stats('memory');
    const u = input.memory.stats('user');
    const lines = [
      '# Memory',
      `Your notebook across sessions is the USER.md / MEMORY.md text above (USER: ${u.entries} entries · MEMORY: ${m.entries} entries, ${m.chars}/${m.limit} chars).`,
      'Save durable things with the `memory` tool as soon as you learn them: preferences ("short answers"), facts about the user, projects and their paths, decisions. One short line each; never secrets or passing details.',
    ];
    if (toolNames.has('session_search')) {
      lines.push(
        'Past conversations are searchable with `session_search` — use it when the user refers to earlier work instead of asking them to repeat.',
      );
    }
    // Nudge on every Nth user turn without a save (8, 16, 24…) — a reminder, not nagging.
    const every = config.memory.nudgeEvery;
    if (
      every > 0 &&
      input.turnsSinceMemorySave >= every &&
      input.turnsSinceMemorySave % every === 0
    ) {
      lines.push(
        `Memory check: ${input.turnsSinceMemorySave} user turns without saving anything. If this conversation revealed a durable preference, fact or decision, save it now (one memory call); otherwise continue.`,
      );
    }
    out.push(lines.join('\n'));
  }

  if (toolNames.has('skill')) {
    const idx = input.skills.index();
    const mode = config.skills.autoCreate;
    const lines = ['# Skills'];
    if (idx.shown) {
      lines.push(
        'Reusable procedures. Before a task that matches one, call `skill` (action read) and follow it:',
        idx.text,
      );
      if (idx.total > idx.shown)
        lines.push(`(+${idx.total - idx.shown} more — \`skill\` action list)`);
    } else {
      lines.push('No skills saved yet.');
    }
    if (toolNames.has('skill_manager') && mode !== 'off') {
      lines.push(
        mode === 'auto'
          ? `After a task that took ≥${config.skills.reflectAfterToolCalls} tool calls and may recur, save it with \`skill_manager\` (clear steps, exact commands, pitfalls). When a skill's step fails and you fix it, update the skill with a changelog note.`
          : `After a task that took ≥${config.skills.reflectAfterToolCalls} tool calls and may recur, offer in one line to save it as a skill; create it with \`skill_manager\` only after the user agrees. When a skill's step fails and you fix it, update the skill with a changelog note.`,
      );
    }
    out.push(lines.join('\n'));
  }
  return out;
}

export interface ReflectInput {
  provider: Provider;
  model: string;
  skills: SkillStore;
  transcript: string;
  signal?: AbortSignal;
  onUsage?: (usage: Usage) => void;
}

interface ReflectionJson {
  save?: boolean;
  name?: string;
  description?: string;
  tags?: string[];
  body?: string;
  reason?: string;
}

const REFLECT_PROMPT = `You are reviewing a finished task between a user and an AI agent to decide whether it is worth saving as a reusable SKILL (a procedure the agent can follow next time with fewer steps).

Save a skill only if ALL hold: the task succeeded; it took several tool steps; the same kind of request is likely to come back (reports, recurring file/project chores, workflows); the steps generalise beyond this one case. Do not save one-off questions, trivial tasks, or anything containing secrets.

Reply with ONLY a JSON object:
{"save": false, "reason": "..."}  or
{"save": true, "name": "kebab-case-name", "description": "one line: when to use it (same language as the user)", "tags": ["..."], "body": "markdown with ## Steps (numbered, exact tool calls/commands/paths), ## Pitfalls"}

Keep body under 2500 characters. If a very similar skill already exists (listed below), reply save:false unless the transcript shows a real improvement — then reuse its exact name so it gets updated.`;

/** One cheap model call; returns what was saved (or undefined). Never throws on model nonsense. */
export async function reflectSkill(
  input: ReflectInput,
): Promise<{ name: string; action: 'created' | 'updated' } | undefined> {
  const existing = input.skills
    .list()
    .map((s) => `- ${s.name}: ${s.description}`)
    .join('\n');
  const messages = [
    { role: 'system' as const, content: REFLECT_PROMPT },
    {
      role: 'user' as const,
      content: `Existing skills:\n${existing || '(none)'}\n\nTranscript:\n${input.transcript}`,
    },
  ];
  let text = '';
  for await (const ev of input.provider.chat(
    { model: input.model, messages, maxTokens: 1500, temperature: 0.2 },
    input.signal,
  )) {
    if (ev.type === 'text') text += ev.delta;
    if (ev.type === 'usage') input.onUsage?.(ev.usage);
    if (ev.type === 'error') throw ev.error;
  }
  const json = extractJson(text);
  if (!json?.save || !json.name || !json.description || !json.body) return undefined;
  const name = json.name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
  if (!isValidSkillName(name)) return undefined;
  const existingSkill = input.skills.get(name);
  if (existingSkill) {
    input.skills.update(name, {
      description: json.description,
      body: json.body,
      tags: json.tags,
      changelog: 'refined after a new successful run',
    });
    return { name, action: 'updated' };
  }
  input.skills.create({ name, description: json.description, body: json.body, tags: json.tags });
  return { name, action: 'created' };
}

function extractJson(text: string): ReflectionJson | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as ReflectionJson;
  } catch {
    return undefined;
  }
}
