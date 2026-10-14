import fs from 'node:fs';
import path from 'node:path';
import { SKILL_FILE, SkillStore } from './index.js';

/**
 * Skills shipped with SINDAR. They are materialised into `~/.sindar/skills/<name>/`
 * on first run (with a `.bundled` marker) so the user can read, edit or delete them.
 * Editing removes the marker; untouched bundled skills are refreshed on upgrades.
 */
export const BUNDLED_SKILLS: ReadonlyArray<{ name: string; content: string }> = [
  {
    name: 'summarize-folder',
    content: `---
name: summarize-folder
description: "تلخيص مجلد: ما بداخله، أهم الملفات، وما الذي يفعله المشروع. Summarize a folder/project: structure, key files, purpose."
version: 1.0.0
tags: [files, analysis]
---

# تلخيص مجلد / Summarize a folder

Use when the user asks "what is in this folder", "explain this project", "لخّص هذا المجلد".

## Steps
1. \`list_dir\` the folder with depth 2. Skip \`node_modules\`, \`.git\`, \`dist\`, \`build\`, caches.
2. Spot the entry points: README*, package.json / pyproject.toml / Cargo.toml / go.mod, main/index files, docs/.
3. \`read_file\` the README (first 120 lines) and the manifest. Read at most 5 more files, heads only (\`limit: 80\`).
4. For big folders use \`search_files\` for "main(", "export default", "TODO" instead of reading everything.
5. Answer in the user's language with this shape:
   - **ما هو** / What it is (1–2 lines)
   - **البنية** / Structure (bullet tree, max 12 lines)
   - **أهم الملفات** / Key files (name → one-line purpose)
   - **ملاحظات** / Notes: TODOs, risks, missing docs
6. Keep it under 300 words unless asked for detail. Offer to write it to \`workspace/reports/\` as markdown.

## Pitfalls
- Never read binaries or files > 1 MB; mention them by size instead.
- On the phone (Termux) outputs are small — prefer heads and counts over full dumps.
`,
  },
  {
    name: 'write-report',
    content: `---
name: write-report
description: "كتابة تقرير أو ملخص منظّم (Markdown أو PDF) وحفظه في مجلد العمل. Write a structured report/summary as markdown or PDF and save it to the workspace."
version: 1.0.0
tags: [writing, files]
---

# كتابة تقرير / Write a report

Use for: تقرير، ملخص، مذكرة، خطة — any document the user wants saved, not just answered in chat.

## Steps
1. Clarify only if the goal or audience is truly unclear (one question max). Otherwise assume: audience = the user, language = the user's.
2. Gather inputs first (files with \`read_file\`, web with \`web_search\`/\`web_fetch\`, past chats with \`session_search\`). Note sources.
3. Outline: title · 2–4 sections · conclusion/next steps. Keep sections short with bullets and tables.
4. Write the file with \`write_file\` to \`<workspace>/reports/YYYY-MM-DD-<slug>.md\` (create the folder; slug in latin letters).
   - PDF wanted (ملف PDF)? Call \`make_pdf\` with the same markdown instead — it renders Arabic correctly and needs no extra programs. Never try pandoc/LaTeX/pip for this.
5. Verify: \`read_file\` the saved file head; fix formatting problems (skip for PDF).
6. Reply with: the path (on the phone also mention Downloads), a 3-line summary, and an offer to adjust tone/length.

## Style
- Arabic reports: use simple, direct language; numbers in western digits; dates like 2026-10-14.
- Add a "المصادر / Sources" section when web or files were used.
`,
  },
  {
    name: 'git-workflow',
    content: `---
name: git-workflow
description: "التعامل الآمن مع git: الحالة، الفروق، commit برسالة واضحة، بدون أوامر مدمّرة. Safe git routine: status, diff, commit with a clear message, no destructive commands."
version: 1.0.0
tags: [git, terminal]
---

# git-workflow

## Routine
1. \`git status --short\` then \`git diff --stat\` — understand what changed before doing anything.
2. If the user asked to commit: \`git add -A\` (or specific paths), then
   \`git commit -m "<type>: <what and why in one line>"\` (types: feat, fix, docs, chore, refactor).
3. Show \`git log --oneline -n 5\` to confirm.
4. Only push when asked: \`git push\` (never \`--force\`). If the push is rejected, explain and propose \`git pull --rebase\`.

## Never do without an explicit request (and say why it is risky)
- \`git reset --hard\`, \`git checkout -- .\`, \`git clean -fd\`, \`git push --force\`, rewriting history, deleting branches.

## Tips
- No repo? Offer \`git init\` and a sensible \`.gitignore\` (node_modules, .env, dist).
- Large diffs: summarise by file instead of printing everything.
- Secrets in the diff (.env, tokens)? Stop and warn before committing.
`,
  },
  {
    name: 'android-termux',
    content: `---
name: android-termux
description: "خصوصيات العمل على جوال أندرويد داخل Termux: الملفات المشتركة، أوامر termux-api، والمهلات. Working on an Android phone inside Termux: shared storage, termux-api commands, timeouts and limits."
version: 1.0.0
tags: [android, termux, terminal]
---

# android-termux

Applies when platform is Android/Termux (the system prompt says so).

## Files
- Phone storage is at \`~/storage/shared\` (Downloads = \`~/storage/shared/Download\`). If missing, ask the user to run \`termux-setup-storage\` once and allow the permission.
- Keep SINDAR outputs in the workspace (\`~/.sindar/workspace\`) unless the user wants them in Downloads.

## termux-api (only if the Termux:API app is installed)
- Always wrap calls in a timeout: \`timeout 10 termux-battery-status\`, \`timeout 10 termux-clipboard-get\`.
- Useful: \`termux-notification -t "title" -c "text"\`, \`termux-clipboard-set\`, \`termux-share <file>\`, \`termux-toast\`, \`termux-open <file>\`, \`termux-vibrate\`.
- If a command hangs or returns nothing, say the API app may be battery-restricted; do not retry more than once.

## Limits
- Mobile data/CPU are limited: prefer \`head\`, \`wc -l\`, \`grep -n\` over dumping whole files; avoid long builds.
- Packages: \`pkg install <name>\` (never \`apt-get\` with sudo — there is no root).
- Long tasks: tell the user to keep Termux open (or let the gateway wake-lock run).
`,
  },
];

/** Write missing bundled skills (and refresh untouched ones). Returns the names written. */
export function ensureBundledSkills(skillsDir: string): string[] {
  const written: string[] = [];
  for (const skill of BUNDLED_SKILLS) {
    const dir = path.join(skillsDir, skill.name);
    const file = path.join(dir, SKILL_FILE);
    const marker = path.join(dir, '.bundled');
    try {
      if (fs.existsSync(file)) {
        // Only refresh skills the user never edited (marker still present) and that changed.
        if (!fs.existsSync(marker)) continue;
        if (fs.readFileSync(file, 'utf8') === skill.content) continue;
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, skill.content, 'utf8');
      SkillStore.markBundled(dir);
      written.push(skill.name);
    } catch {
      /* non-fatal */
    }
  }
  return written;
}
