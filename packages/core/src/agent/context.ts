import fs from 'node:fs';
import path from 'node:path';
import type { Config, Lang } from '../config/schema.js';
import type { SindarPaths } from '../paths.js';
import type { PlatformInfo } from '../platform.js';
import type { Tool } from '../tools/types.js';
import { ensureBundledSkills } from '../skills/bundled.js';

export const DEFAULT_SOUL = `# SOUL.md — شخصية SINDAR / SINDAR's personality

أنت **SINDAR**: مساعد شخصي ذكي يعمل على جهاز المستخدم نفسه (جوال أو كمبيوتر)، مجاني ومفتوح المصدر.
You are **SINDAR**: a personal AI agent running on the user's own device. Free and open source.

## كيف تتصرف / How you behave
- مباشر وعملي: نفّذ المهمة بالأدوات بدل الاكتفاء بالشرح. Be direct and practical — do the task with tools rather than only explaining.
- اسأل سؤالاً واحداً واضحاً فقط عندما يكون الغموض حقيقياً. Ask one clear question only when the ambiguity is real.
- تحقّق من نتائج أدواتك قبل أن تعلن النجاح. Verify tool results before claiming success.
- لا تخترع حقائق؛ عندما لا تعرف قل ذلك وابحث. Never invent facts; say so and look it up.
- احترم خصوصية المستخدم: لا تنقل أسراره خارج الجهاز إلا بطلبه. Respect privacy: never move secrets off-device unless asked.
- تحدّث بلغة المستخدم (العربية افتراضياً) بأسلوب بسيط وودود. Reply in the user's language (Arabic by default), simply and warmly.
`;

export const DEFAULT_USER = `# USER.md — ما أعرفه عن المستخدم / What I know about the user

(يُحدَّث تلقائياً مع الوقت — ويمكنك تعديله بنفسك.)
(Updated over time — you can edit it yourself.)

- اللغة المفضلة / Preferred language: العربية
`;

export const DEFAULT_MEMORY = `# MEMORY.md — الذاكرة طويلة الأمد / Long-term memory

(حقائق، تفضيلات، قرارات تستحق التذكّر. سطر لكل عنصر.)
(Facts, preferences and decisions worth remembering. One line each.)
`;

export function ensureIdentityFiles(paths: SindarPaths): string[] {
  const created: string[] = [];
  const files: Array<[string, string]> = [
    [paths.soul, DEFAULT_SOUL],
    [paths.user, DEFAULT_USER],
    [paths.memory, DEFAULT_MEMORY],
  ];
  for (const [file, content] of files) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
      created.push(file);
    }
  }
  for (const name of ensureBundledSkills(paths.skills)) created.push(path.join(paths.skills, name));
  return created;
}

function readCapped(
  file: string,
  maxChars: number,
  keep: 'head' | 'tail' = 'head',
): string | undefined {
  try {
    const t = fs.readFileSync(file, 'utf8');
    if (t.length <= maxChars) return t;
    if (keep === 'tail') {
      // Memory grows at the end: when it must be cut, the newest entries matter most.
      const nl = t.indexOf('\n');
      const head = nl > 0 && nl < 200 ? t.slice(0, nl + 1) : '';
      return `${head}…(older entries omitted)\n${t.slice(t.length - (maxChars - head.length))}`;
    }
    return `${t.slice(0, maxChars)}\n…(truncated)`;
  } catch {
    return undefined;
  }
}

/** AGENTS.md files from cwd upwards (closest last so it wins), bounded. */
export function findProjectContext(
  cwd: string,
  stopAt?: string,
  maxFiles = 3,
  maxChars = 6000,
): Array<{ file: string; content: string }> {
  const out: Array<{ file: string; content: string }> = [];
  let dir = path.resolve(cwd);
  const stop = stopAt ? path.resolve(stopAt) : undefined;
  for (;;) {
    for (const name of ['AGENTS.md', 'SINDAR.md', 'CLAUDE.md']) {
      const f = path.join(dir, name);
      if (fs.existsSync(f)) {
        const content = readCapped(f, maxChars);
        if (content) out.push({ file: f, content });
        break;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === stop || out.length >= maxFiles) break;
    dir = parent;
  }
  return out.reverse();
}

export interface ContextInput {
  config: Config;
  paths: SindarPaths;
  platform: PlatformInfo;
  lang: Lang;
  cwd: string;
  workspace: string;
  tools: Tool[];
  approvalMode: string;
  now?: Date;
  timeZone?: string;
  /** Extra sections appended by later milestones (skills index, memory nudges…). */
  extraSections?: string[];
  /**
   * Rough character budget for the whole prompt (from the model's per-request token cap).
   * Shrinks the identity/memory/project sections proportionally so small free-tier models
   * (Groq: ~8k tokens per request) keep room for the conversation itself.
   */
  charBudget?: number;
}

export function buildSystemPrompt(input: ContextInput): string {
  const { paths, platform, lang, cwd, workspace, tools } = input;
  const now = input.now ?? new Date();
  const tz = input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sections: string[] = [];

  const cb = input.charBudget;
  const capOf = (def: number, share: number) =>
    cb ? Math.min(def, Math.max(600, Math.floor(cb * share))) : def;

  sections.push(readCapped(paths.soul, capOf(8000, 0.15)) ?? DEFAULT_SOUL);

  const user = readCapped(paths.user, capOf(6000, 0.08));
  if (user?.trim()) sections.push(user);
  const memory = readCapped(paths.memory, capOf(12000, 0.14), 'tail');
  if (memory?.trim()) sections.push(memory);

  for (const p of findProjectContext(cwd, platform.home, 3, capOf(6000, 0.1)))
    sections.push(`# Project context (${p.file})\n\n${p.content}`);

  const os = platform.isTermux
    ? `Android / Termux ${platform.termuxVersion ?? ''}`.trim()
    : `${platform.os} (${platform.release})`;
  const env = [
    `# Environment`,
    `- Date/time: ${now.toISOString().replace('T', ' ').slice(0, 16)} UTC (user time zone: ${tz})`,
    `- Device: ${os} · ${platform.arch} · Node ${platform.nodeVersion} · shell: ${path.basename(platform.shell)}`,
    `- Working directory: ${cwd}`,
    `- Workspace (writes here never need approval): ${workspace}`,
    `- SINDAR home: ${paths.home}`,
    `- Interface language: ${lang === 'ar' ? 'Arabic' : 'English'} — answer in the language the user writes in.`,
  ];
  if (platform.isTermux) {
    env.push(
      `- Termux notes: shared storage is under ~/storage/shared (Downloads, DCIM, Documents) after termux-setup-storage; use "pkg" to install packages; termux-api commands (termux-notification, termux-clipboard-get, termux-battery-status…) exist if Termux:API is installed.`,
    );
  }
  sections.push(env.join('\n'));

  if (tools.length) {
    const names = tools.map((t) => `\`${t.name}\``).join(', ');
    sections.push(
      [
        `# Tools`,
        `Available: ${names}.`,
        `- Prefer tools over guessing: read files before editing, run commands to check results.`,
        `- Approval mode is "${input.approvalMode}": risky actions (shell commands, writes outside the workspace) may require the user's confirmation; a denied call returns an error — respect it and suggest an alternative instead of retrying the same call.`,
        `- Keep tool calls focused; batch independent reads. Long outputs are truncated — ask for ranges.
- Never repeat a tool call with the same arguments: its result is already in the conversation (an empty listing really is empty).`,
        `- When done, summarize what changed and where (paths) in one short message.`,
        ...(tools.some((t) => t.name === 'make_pdf')
          ? [
              `- Documents: \`make_pdf\` turns text/markdown into a real PDF (Arabic supported) — use it for any "PDF" request instead of installing converters.`,
            ]
          : []),
      ].join('\n'),
    );
  }
  for (const s of input.extraSections ?? []) sections.push(s);
  return sections.join('\n\n---\n\n');
}

/**
 * Rough token estimate. Arabic tokenizes badly on most models (measured on Groq/gpt-oss:
 * ~1.6 chars per token for news prose), Latin prose/code ≈ 3.8. The loop refines this per
 * model from the provider's real `prompt_tokens` (see ProviderRegistry.calibrate).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const other = text.length - arabic;
  return Math.ceil(arabic / 1.7 + other / 3.8);
}
