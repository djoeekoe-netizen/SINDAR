# SINDAR — الخطة الشاملة (V1)

> **SINDAR** مساعد ذكاء اصطناعي شخصي، **مجاني ومفتوح المصدر (MIT)**، يعمل على جهازك أنت، يصلك في القنوات التي تستخدمها (الويب، الطرفية، Telegram…)، ويتعلّم منك ومن تجاربه مع الوقت.
>
> **المعادلة:** معمارية **OpenClaw** (Gateway + Control UI + قنوات + إضافات) × عقل **Hermes** (ذاكرة + مهارات ذاتية التحسّن + بحث في الجلسات + Cron + وكلاء فرعيون) — **عربي أولاً، مجاني أولاً.**

---

## 0) الملخص التنفيذي

| البند | القيمة |
|---|---|
| **المنتج** | وكيل AI شخصي ذاتي الاستضافة (Self-hosted Personal Agent) |
| **المستخدم** | فرد (أو فريق صغير) يريد مساعداً خاصاً تبقى بياناته وذاكرته ومفاتيحه على جهازه |
| **شكل V1** | **Gateway** محلي + **واجهة ويب** (عربي/إنجليزي، RTL) + **CLI** + قناة **Telegram** |
| **النماذج** | أي مزود: محلي (Ollama / LM Studio / llama.cpp) أو سحابي بمفتاحك — **الافتراضي مجاني** |
| **التقنية** | TypeScript · Node.js 22+ · SQLite مدمج (FTS5) · Hono · React · grammY |
| **الرخصة** | MIT |
| **التكلفة** | **0** — انظر §3 |

### معايير نجاح V1 (قابلة للقياس)
1. من التثبيت إلى أول محادثة ناجحة في **أقل من 5 دقائق** (`sindar onboard`).
2. الوكيل ينفّذ مهمة متعددة الخطوات بالأدوات (ملفات + طرفية + ويب) مع **موافقة المستخدم** على الأوامر الحساسة.
3. يتذكر حقيقة قلتها له في جلسة سابقة **من قناة مختلفة** (ويب → Telegram).
4. ينشئ **مهارة** من مهمة معقدة ويعيد استخدامها تلقائياً عندما تتكرر.
5. مهمة مجدولة (**Cron**) تصلك على Telegram في وقتها دون تدخل.
6. يعمل بالكامل **دون أي اشتراك مدفوع** (Ollama أو طبقة مجانية سحابية).

---

## 1) ماذا نأخذ من كلٍّ منهما

| الميزة | المصدر | في SINDAR | المرحلة |
|---|---|---|---|
| Gateway محلي = مركز تحكم للجلسات/الأدوات/القنوات | OpenClaw | `@sindar/gateway` | M2 |
| Control UI ويب | OpenClaw | React SPA يخدمها الـ Gateway نفسه | M2 |
| CLI + أوامر slash مشتركة بين الواجهات | كلاهما | `sindar chat` + `/new /model /usage /skills …` | M1 |
| ملفات الهوية: `SOUL.md` / `AGENTS.md` | كلاهما | نفس الأسماء (توافق + ترحيل سهل) | M1/M3 |
| ذاكرة `MEMORY.md` + `USER.md` مع **تنبيهات دورية** للحفظ | Hermes | أداة `memory` + nudge كل N دورات | M3 |
| **بحث في الجلسات السابقة** FTS5 + تلخيص | Hermes | أداة `session_search` على SQLite FTS5 | M3 |
| **مهارات** بصيغة agentskills.io + **إنشاء ذاتي بعد المهام المعقدة** + تحسين أثناء الاستخدام | Hermes | `skills/` + `skill_manager` + انعكاس تلقائي | M3 |
| تثبيت مهارات من GitHub / ClawHub | كلاهما | `sindar skills install <repo>` | M3 |
| قنوات: Telegram, Discord, WhatsApp, Slack… | كلاهما | واجهة `ChannelAdapter` موحّدة؛ Telegram أولاً | M4/M7 |
| DM Pairing (اقتران المرسل المجهول بكود) | كلاهما | `sindar pairing approve` + من الواجهة | M4 |
| استمرارية المحادثة عبر المنصات | Hermes | جلسة واحدة لكل مستخدم عبر القنوات | M4 |
| **Cron** بالتسليم لأي قناة | كلاهما | `cron` tool + runner في الـ Gateway | M5 |
| **وكلاء فرعيون** متوازون (delegate) | Hermes | `delegate` + حد تزامن | M5 |
| موافقة على الأوامر + allowlist + كشف الأوامر الخطرة | كلاهما | محرك سياسات + approval floors | M1/M6 |
| تنفيذ معزول: Docker / SSH backends | Hermes | `TerminalBackend` قابل للتبديل | M6 |
| MCP client | كلاهما | stdio + HTTP | M7 |
| Plugin SDK (أدوات/قنوات/مزودون كإضافات) | OpenClaw | `@sindar/plugin-sdk` | M7 |
| متصفح، رؤية، صوت (STT/TTS)، توليد صور | كلاهما | مسار مجاني لكل منها | M7 |
| ترحيل من OpenClaw / Hermes | Hermes | `sindar migrate --from openclaw\|hermes` | M8 |
| سكربت تثبيت بسطر واحد + Docker + onboarding | كلاهما | `install.sh` / `install.ps1` / `docker compose` | M8 |

**ما لن ننسخه في V1 (بوعي):** تطبيقات أصلية iOS/macOS/Android، مكالمات صوتية وبوتات اجتماعات، 20+ قناة، 100+ مزود، توليد فيديو/موسيقى، بيئات Modal/Daytona السحابية. (مؤجلة لـ §20.)

---

## 2) القرارات المعمارية (ADRs)

| # | القرار | البدائل المرفوضة | السبب |
|---|---|---|---|
| **ADR-01** | **TypeScript / Node.js ≥ 22.12** للنواة والـ Gateway والواجهة | Python (Hermes)، هجين | لغة واحدة = تشغيل أبسط للمستخدم (`npm i -g`)، نفس اللغة للواجهة، نظام npm غني بمكتبات القنوات (grammY, discord.js, Baileys) |
| **ADR-02** | **SQLite مدمج** عبر `node:sqlite` (تحقّقنا: FTS5 يعمل، إصدار 3.51) | better-sqlite3، Postgres، LanceDB | **صفر تبعيات أصلية** (لا تجميع على Windows)، ملف واحد، FTS5 للبحث النصي، لا سيرفر قاعدة بيانات |
| **ADR-03** | **Monorepo بـ pnpm workspaces** | حزمة واحدة، npm workspaces | فصل واضح core/gateway/cli/ui/channels، نشر حزم مستقلة لاحقاً |
| **ADR-04** | **مزود OpenAI-compatible** (fetch + SSE) كمحوّل عام + **Anthropic** أصلي + **mock** للاختبارات | SDK لكل مزود، Vercel AI SDK | واجهة `/v1/chat/completions` تغطي: Ollama، LM Studio، llama.cpp، vLLM، OpenRouter، Groq، Gemini (نقطة التوافق)، Mistral، DeepSeek، xAI، GitHub Models، Cerebras — بمحوّل واحد |
| **ADR-05** | **ملفات نصية** للهوية والذاكرة (`SOUL.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`) + **SQLite** للجلسات/البحث/Cron/الموافقات | كل شيء في DB | الملفات يقرأها ويعدّلها المستخدم، قابلة للنسخ الاحتياطي بـ git، ومتوافقة مع OpenClaw/Hermes للترحيل |
| **ADR-06** | **Telegram أولاً** عبر **long polling** | WhatsApp، Discord | مجاني، بدون دومين/HTTPS/IP عام، API رسمي مستقر، صفر خطر حظر |
| **ADR-07** | **Gateway موثوق / تنفيذ غير موثوق** + موافقات افتراضية على الطرفية والكتابة خارج مساحة العمل | yolo افتراضي | رسائل القنوات مدخلات غير موثوقة؛ نسخ مبدأ OpenClaw الأمني |
| **ADR-08** | الواجهة **SPA ثابتة يخدمها الـ Gateway** على نفس المنفذ | سيرفر منفصل، SSR | عملية واحدة، منفذ واحد، لا CORS، تعمل من الجوال على نفس الشبكة |
| **ADR-09** | **مجاني أولاً**: كل ميزة لها **مسار مجاني افتراضي** وأي مزود مدفوع اختياري | الاعتماد على API مدفوع | متطلب المنتج الأساسي |
| **ADR-10** | **التوافق مع المعايير المفتوحة**: مهارات agentskills.io (`SKILL.md`)، MCP، OpenAI tool-calling schema | صيغ خاصة | تثبيت مهارات جاهزة من ClawHub/GitHub، واستخدام آلاف خوادم MCP |
| **ADR-11** | **الإعدادات**: `~/.sindar/config.yaml` (غير سرّي) + `~/.sindar/.env` (المفاتيح) | ملف واحد | المفاتيح لا تختلط بالإعدادات القابلة للمشاركة |

---

## 3) مبدأ «مجاني أولاً» — جدول التكلفة

| البند | التكلفة | المسار المجاني الافتراضي | البديل المدفوع (اختياري) |
|---|---|---|---|
| كود SINDAR وكل المكتبات | **0** | MIT + npm | — |
| GitHub (كود، CI، إصدارات، توثيق) | **0** | Actions + Pages | — |
| التشغيل | **0** | لابتوب/PC/Raspberry Pi/جوال Termux | VPS ~15–20 ريال/شهر أو Oracle Cloud Always Free |
| **النموذج** | **0** | **Ollama** محلياً (8GB+ RAM لنماذج 3–4B، 16GB+ لـ 7–14B) **أو** طبقة مجانية: Groq، Google Gemini، OpenRouter (`:free`)، Mistral، GitHub Models، Cerebras *(حدودها تتغير — نتحقق وقت الاستخدام)* | OpenAI / Anthropic بمفتاحك |
| Telegram / Discord | **0** | Bot API رسمي | — |
| WhatsApp | 0 (غير رسمي، خطر حظر) | Baileys مع تحذير واضح | Business API (توثيق Meta) |
| الوصول من خارج المنزل | **0** | Tailscale أو Cloudflare Tunnel | — |
| بحث ويب | **0** | DuckDuckGo HTML / SearXNG ذاتي | Brave/Tavily (لهما طبقة مجانية) |
| صوت STT / TTS | **0** | whisper.cpp + Piper / Edge-TTS | ElevenLabs، OpenAI |
| متصفح | **0** | Playwright + Chromium | Browser Use cloud |
| توليد صور | **0** | Pollinations / Stable Diffusion محلي | FAL، OpenAI |

> **القاعدة:** لا تُضاف ميزة إلى SINDAR إلا ولها مسار مجاني يعمل. المدفوع دائماً «إضافة» وليس «شرطاً».

---

## 4) نطاق V1

### ✅ داخل النطاق
- محادثة بالبث (streaming) مع أي مزود OpenAI-compatible أو Anthropic، تبديل النموذج بأمر واحد.
- حلقة وكيل كاملة مع استدعاء أدوات: طرفية، ملفات (قراءة/كتابة/تعديل/بحث)، جلب صفحات ويب، بحث ويب.
- جلسات دائمة في SQLite + بحث نصي كامل فيها.
- هوية وذاكرة: `SOUL.md`، `USER.md`، `MEMORY.md`، `AGENTS.md` (سياق المشروع) + تنبيهات حفظ.
- مهارات: تحميل/إنشاء/تحديث/تثبيت من GitHub، وانعكاس ذاتي بعد المهام المعقدة.
- ضغط السياق التلقائي عند الاقتراب من الحد.
- Gateway: HTTP + WebSocket، توكن وصول، واجهة ويب عربية/إنجليزية RTL، موافقات من الواجهة.
- CLI: `onboard`, `chat`, `gateway`, `dashboard`, `model`, `skills`, `pairing`, `cron`, `doctor`, `migrate`.
- Telegram: اقتران، allowlist، أوامر slash، تجزئة الرسائل، مؤشر الكتابة، استمرارية الجلسة مع الويب.
- Cron: جدولة بلغة طبيعية + تسليم للقنوات. وكلاء فرعيون متوازون. قائمة مهام.
- الأمان: أوضاع موافقة (`ask` / `allowlist` / `yolo`) + حدود دنيا للأوامر الخطرة + حراسة المسارات + Docker backend.
- MCP client، Plugin SDK، Discord، متصفح، صوت، صور (M7) — بمسارات مجانية.
- تثبيت بسطر واحد، Docker Compose، ترحيل من OpenClaw/Hermes.

### ❌ خارج النطاق (مؤجل لما بعد V1)
- تطبيقات أصلية للجوال/سطح المكتب (ممكن PWA + Tauri لاحقاً).
- مكالمات صوتية، بوتات اجتماعات، wake word.
- توليد فيديو/موسيقى، بيئات سحابية (Modal/Daytona).
- تعدد المستأجرين (multi-tenant) وفرق كبيرة بصلاحيات معقدة.
- تدريب نماذج / توليد Trajectories.

---

## 5) المعمارية

```
┌─────────────────────────── واجهات المستخدم ───────────────────────────┐
│   Web Control UI (React)   │   CLI / TUI  (sindar chat)   │  Telegram  │
└──────────────┬─────────────┴───────────────┬──────────────┴──────┬─────┘
               │ WS/HTTP + token             │ in-process          │ Bot API (long polling)
┌──────────────▼─────────────────────────────▼─────────────────────▼─────┐
│                       SINDAR Gateway  (@sindar/gateway)                 │
│   Sessions API · Event Bus · Approvals · Channel Router · Cron Runner   │
│   Auth (token) · Static UI · Health                                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                         Agent Core  (@sindar/core)                      │
│   Agent Loop · Context Builder · Compression · Tool Registry/Toolsets   │
│   Providers (openai-compat · anthropic · mock)                           │
│   Memory (MEMORY/USER) · Skills · Session Search (FTS5) · Delegation     │
│   Policy Engine (approvals) · Terminal Backends (local → docker → ssh)   │
└──────┬───────────────────┬──────────────────────┬──────────────────┬────┘
       │                   │                      │                  │
   SQLite             ~/.sindar/              Terminal            LLM Providers
  sindar.db        SOUL.md USER.md           local shell        Ollama · Groq
 (sessions,        MEMORY.md config.yaml     docker · ssh       OpenRouter · Gemini
  fts, cron,       skills/  cron/  logs/                        Anthropic · OpenAI …
  approvals)
```

**القواعد المعمارية الثلاث:**
1. **النواة لا تعرف الواجهات.** `@sindar/core` تصدر دوال وأحداثاً فقط؛ الـ CLI والـ Gateway والقنوات مستهلكون.
2. **كل شيء حدث (event).** الوكيل يبث `message.delta`, `tool.call`, `tool.result`, `approval.request`, `usage`… والواجهات تعرضها. نفس الأحداث للويب والطرفية وTelegram.
3. **المدخلات من القنوات غير موثوقة.** تُغلَّف وتُوسَم؛ لا تنفيذ أوامر من رسالة واردة بدون سياسة الموافقة.

---

## 6) مجلد المستخدم `~/.sindar/`

```
~/.sindar/
├── config.yaml        # الإعدادات (مزود/نموذج افتراضي، أدوات مفعّلة، وضع الموافقة، القنوات…)
├── .env               # المفاتيح والتوكنات فقط (chmod 600)
├── sindar.db          # SQLite: sessions, messages(+FTS5), approvals, cron_jobs, pairings, usage
├── SOUL.md            # شخصية الوكيل (قابلة للتعديل)
├── USER.md            # ما يعرفه الوكيل عنك (يكتبه هو + أنت)
├── MEMORY.md          # ذاكرة طويلة الأمد (حقائق/تفضيلات/قرارات)
├── skills/            # مهارات المستخدم + المثبّتة  (<name>/SKILL.md [+ scripts/, references/])
├── workspace/         # مساحة العمل الافتراضية للأدوات (قابلة للتغيير)
├── logs/              # سجلات مدوّرة (بدون أسرار)
└── backups/           # نسخ تلقائية قبل الترحيل/الترقية
```
> كل ما في هذا المجلد **ملكك**، ولا يغادر جهازك إلا ما ترسله أنت لمزود النموذج.

---

## 7) نموذج البيانات (SQLite)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, title TEXT, channel TEXT NOT NULL,      -- 'web' | 'cli' | 'telegram' | 'cron' | 'subagent'
  user_id TEXT, parent_id TEXT, model TEXT, cwd TEXT,
  summary TEXT,                                               -- ملخص الضغط التراكمي
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,                                         -- system | user | assistant | tool
  content TEXT,                                               -- نص أو JSON للأجزاء المتعددة
  tool_calls TEXT, tool_call_id TEXT, name TEXT,
  tokens_in INTEGER, tokens_out INTEGER, created_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid');
CREATE TABLE approvals (id TEXT PRIMARY KEY, session_id TEXT, tool TEXT, args TEXT, risk TEXT,
  status TEXT, decided_by TEXT, created_at INTEGER, decided_at INTEGER);
CREATE TABLE cron_jobs (id TEXT PRIMARY KEY, name TEXT, schedule TEXT, timezone TEXT, prompt TEXT,
  deliver_to TEXT, enabled INTEGER, last_run INTEGER, last_status TEXT, next_run INTEGER, created_at INTEGER);
CREATE TABLE pairings (channel TEXT, user_id TEXT, display_name TEXT, code TEXT, status TEXT,
  created_at INTEGER, PRIMARY KEY (channel, user_id));
CREATE TABLE usage (id INTEGER PRIMARY KEY, session_id TEXT, provider TEXT, model TEXT,
  tokens_in INTEGER, tokens_out INTEGER, created_at INTEGER);
```
المهارات والذاكرة والهوية = **ملفات** (ADR-05)؛ المخطط يُدار بـ migrations مرقّمة داخل `@sindar/core/db`.

---

## 8) طبقة المزودين (Providers)

```ts
interface Provider {
  id: string;                                  // 'ollama' | 'openrouter' | 'groq' | 'anthropic' | 'mock' …
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent>;   // بث: text | tool_call | usage | done
  capabilities: { tools: boolean; vision: boolean; contextWindow?: number };
}
```
- **`openai-compat`**: محوّل واحد بإعدادات `baseUrl` + `apiKeyEnv` + `headers`. قوالب جاهزة في `providers.yaml`: Ollama (`http://localhost:11434/v1`)، LM Studio، llama.cpp، vLLM، OpenRouter، Groq، Gemini، Mistral، DeepSeek، xAI، GitHub Models، Cerebras، Together، أي `custom`.
- **`anthropic`**: Messages API أصلي (أدوات + بث + prompt caching).
- **`mock`**: مزود حتمي للاختبارات الآلية وللتطوير بدون شبكة (البيئة التي أبني فيها لا تصل لمزودات النماذج، لذا الاختبارات الآلية عليه، والاختبار الحقيقي على جهازك).
- اختيار النموذج: `provider:model` (مثل `ollama:qwen3:8b`، `groq:llama-3.3-70b-versatile`) + **سلسلة احتياط** اختيارية `fallbacks: [...]` عند الخطأ/الحد.
- تتبع الاستخدام (tokens) لكل جلسة ومزود → `/usage` و`/insights`.

---

## 9) حلقة الوكيل (Agent Loop)

```
1. بناء الـ System Prompt (Context Builder):
   هوية (SOUL.md) + المستخدم (USER.md) + الذاكرة (MEMORY.md)
   + سياق المشروع (AGENTS.md من cwd والمجلدات الأعلى)
   + فهرس المهارات (الاسم + الوصف فقط — التفاصيل تُحمَّل عند الطلب)
   + تعريفات الأدوات (حسب الـ toolset المفعّل) + التاريخ/الوقت/المنصة/المنطقة الزمنية
2. التاريخ: ملخص الضغط (إن وُجد) + آخر N دورة حرفياً
3. استدعاء المزود بالبث → بث الأحداث للواجهة
4. إن وُجدت tool_calls:
     لكل أداة: محرك السياسات → (تلقائي | طلب موافقة | رفض)
     تنفيذ بمهلة + اقتطاع المخرجات الطويلة (مع حفظ الأصل في ملف مؤقت) → نتائج → العودة لـ 3
   حد أقصى للدورات (قابل للضبط) + إيقاف من المستخدم في أي لحظة (interrupt & redirect)
5. بعد الرد:
     - Memory nudge: إن مرّت N دورات بدون كتابة ذاكرة → تذكير نظامي خفيف
     - Skill reflection: إن تجاوزت المهمة عتبة التعقيد (مثلاً ≥ 8 استدعاءات أدوات ناجحة)
       → سؤال داخلي: «هل هذا قابل للتكرار؟» → إنشاء/تحديث مهارة
6. ضغط السياق: عند تجاوز ~75% من نافذة النموذج → تلخيص الدورات القديمة في `sessions.summary`
```

---

## 10) الأدوات (Tools) والمجموعات (Toolsets)

| المجموعة | الأدوات | ملاحظات |
|---|---|---|
| `files` | `read_file`, `write_file`, `edit_file` (بحث/استبدال)، `list_dir`, `search_files` (ripgrep إن وُجد وإلا بديل JS) | حراسة مسارات؛ الكتابة خارج `workspace` تطلب موافقة |
| `terminal` | `terminal` (أمر، مهلة، خلفية)، `process` (قائمة/قراءة/إيقاف العمليات الخلفية) | backends: local → docker → ssh |
| `web` | `web_fetch` (URL → Markdown نظيف)، `web_search` (DDG/SearXNG/Brave) | قائمة سوداء للشبكات الداخلية (SSRF) |
| `memory` | `memory` (add/replace/remove على MEMORY.md و USER.md)، `session_search` | قلب حلقة التعلّم |
| `skills` | `skills` (list/view)، `skill_manager` (create/edit/patch/delete) + `sindar skills install` | صيغة agentskills.io |
| `tasks` | `todo` (قائمة مهام الجلسة)، `clarify` (سؤال للمستخدم بخيارات) | |
| `automation` | `cron` (create/list/update/delete/run)، `delegate` (وكيل فرعي)، `send_message` | M5 |
| `media` | `vision` (وصف صورة)، `tts`, `stt`, `image_generate` | M7 — مسارات مجانية |
| `browser` | `browser` (navigate/click/type/snapshot/screenshot) عبر Playwright | M7 |
| `mcp` | أدوات خوادم MCP المضافة (تُسجَّل ديناميكياً) | M7 |

- تعريف الأداة بـ **zod** → يُولَّد منه JSON Schema للمزود تلقائياً.
- المخرجات الكبيرة تُقتطع لـ ~N حرف مع إشارة للملف الكامل.
- كل أداة تحمل `risk: 'read' | 'write' | 'exec' | 'network'` تستخدمه سياسة الموافقة.

---

## 11) حلقة التعلّم (جوهر Hermes)

### 11.1 الذاكرة
- **`MEMORY.md`**: حقائق/قرارات/تفضيلات عامة. **`USER.md`**: من أنت، أسلوبك، سياقك. كلاهما يُحقن في System Prompt دائماً (بحد أقصى للحجم، والفائض يُلخَّص).
- أداة `memory` بعمليات ذرّية على مداخل مرقّمة (لا إعادة كتابة الملف كاملاً).
- **Nudge**: كل N دورات بدون حفظ → رسالة نظامية قصيرة: «راجع إن كان في هذه المحادثة ما يستحق الحفظ».

### 11.2 البحث في الجلسات
- `session_search(query)` → FTS5 على `messages` → أفضل K جلسات بمقتطفات + تاريخ + قناة → اختيارياً تلخيص جلسة كاملة بالنموذج عند الطلب.

### 11.3 المهارات
```
skills/<name>/
├── SKILL.md            # frontmatter: name, description, (version, tags) + خطوات/إرشادات
├── scripts/            # اختياري: سكربتات مساعدة
└── references/         # اختياري: مراجع
```
- **التحميل التدريجي**: الفهرس (اسم+وصف) في الـ prompt، والمحتوى يُقرأ عند الحاجة.
- **إنشاء ذاتي**: بعد مهمة معقدة ناجحة → الوكيل يقترح مهارة؛ وضع `auto` ينشئها مباشرة، وضع `ask` يسألك.
- **تحسين أثناء الاستخدام**: عندما تفشل خطوة من مهارة ويُصلحها الوكيل → `skill_manager.patch` يحدّث المهارة (مع سجلّ تغييرات).
- **Hub**: `sindar skills install github:user/repo[/path]` و ClawHub، مع **فحص أمني** (لا سكربتات تنفَّذ تلقائياً، مراجعة قبل التفعيل).

### 11.4 سياق المشروع
- `AGENTS.md` (أو `.sindar/context.md`) يُلتقط من مجلد العمل وما فوقه — تعليمات خاصة بكل مشروع.

---

## 12) Gateway + واجهة الويب

**الـ Gateway** (Hono + ws): عملية واحدة، منفذ واحد (افتراضي `18789`)، يربط على `127.0.0.1` افتراضياً؛ `--host 0.0.0.0` يتطلب توكن إلزامي.

| المسار | الوظيفة |
|---|---|
| `GET /health` | حالة + إصدار |
| `GET/POST /api/sessions`, `GET /api/sessions/:id/messages` | إدارة الجلسات |
| `WS /ws?token=…` | إرسال رسائل + استقبال الأحداث (`message.delta`, `tool.call`, `tool.result`, `approval.request`, `usage`, `session.updated`) |
| `POST /api/approvals/:id` | قبول/رفض (مرة واحدة / دائماً لهذا النمط) |
| `GET /api/models`, `PUT /api/sessions/:id/model` | قائمة النماذج وتبديلها |
| `GET/PUT /api/config` | الإعدادات غير السرّية |
| `GET /api/skills`, `GET /api/cron`, `GET /api/pairings` | إدارة |
| `GET /` | الواجهة الثابتة (SPA) |

**واجهة الويب** (React + Vite + Tailwind): عربية RTL افتراضياً + إنجليزية، وضع داكن، قائمة الجلسات، محادثة بالبث مع عرض استدعاءات الأدوات قابلة للطي، **بطاقة موافقة** مضمّنة في المحادثة، مبدّل نموذج، صفحات: الذاكرة (تحرير MEMORY/USER)، المهارات، Cron، القنوات/الاقتران، الإعدادات. تعمل من الجوال (PWA لاحقاً).

---

## 13) القنوات

```ts
interface ChannelAdapter {
  id: 'telegram' | 'discord' | 'whatsapp' | 'slack' | …;
  start(ctx: ChannelContext): Promise<void>;      // يستقبل الرسائل ويمررها للـ Router
  send(target: string, msg: OutgoingMessage): Promise<void>;   // نص/Markdown/ملف/صورة/صوت
  stop(): Promise<void>;
}
```
**Telegram (M4)** عبر grammY — long polling (لا دومين):
- **الاقتران**: مرسل مجهول ← كود من 6 أحرف ← `sindar pairing approve telegram <code>` أو من الواجهة ← allowlist دائمة.
- أوامر: `/new`, `/model`, `/status`, `/stop`, `/skills`, `/usage`, `/sethome` (تعيين محادثة التسليم الافتراضية).
- **استمرارية**: مستخدم واحد = جلسة نشطة واحدة مشتركة بين الويب وTelegram (قابلة للفصل).
- تجزئة الرسائل (4096)، تحويل Markdown → Telegram HTML، مؤشر الكتابة، تحرير الرسالة أثناء البث، الصور والملفات، الرسائل الصوتية → STT (M7).

Discord / WhatsApp (Baileys، مع تحذير) / Slack في M7 بنفس الواجهة.

---

## 14) الأتمتة والتفويض

- **Cron**: `cron` tool ينشئ مهمة من لغة طبيعية («كل يوم 8 صباحاً…») → النموذج يحوّلها لتعبير cron + منطقة زمنية (Asia/Riyadh افتراضياً) → **تأكيد** للمستخدم → حفظ في SQLite → الـ Runner داخل الـ Gateway (مكتبة `croner`) يشغّلها في **جلسة معزولة** ويسلّم النتيجة لـ `deliver_to` (telegram:chat_id | web | cli-log). سجلّ تشغيل + إعادة محاولة.
- **Delegate**: وكيل فرعي بجلسة مستقلة + toolset محدود + مهلة؛ الأب يستلم ملخصاً فقط (لا ينفجر سياقه)؛ تنفيذ متوازٍ بحد تزامن (افتراضي 3).
- **عمليات الخلفية**: `terminal` بوضع `background` + `process` للقراءة/الإيقاف.
- **Todo**: قائمة مهام الجلسة تظهر في الواجهة.

---

## 15) الأمان

| الطبقة | الآلية |
|---|---|
| **سياسة الموافقة** | `ask` (افتراضي: كل `exec`/`write` خارج workspace/`network` حسّاس) · `allowlist` (أنماط معتمدة تلقائياً مثل `git status`, `ls`, `npm test`) · `yolo` (لا يسأل — تحذير صريح) |
| **حدود دنيا (approval floors)** | أوامر مدمّرة (`rm -rf /`, `mkfs`, `dd`, `curl … \| sh`, تعديل `.env`/مفاتيح SSH) تطلب موافقة **حتى في yolo** |
| **حراسة المسارات** | رفض الوصول لـ `~/.sindar/.env`, `~/.ssh`, ملفات النظام؛ `workspace` هو الافتراضي |
| **مدخلات القنوات** | تُوسَم كغير موثوقة؛ الروابط لا تُجلَب تلقائياً بلا طلب؛ مخرجات الأدوات «بيانات» لا «أوامر» |
| **الأسرار** | في `.env` فقط، لا تدخل الـ prompt، تُحجب في السجلات والواجهة |
| **الشبكة** | Gateway على localhost افتراضياً؛ توكن إلزامي عند الفتح؛ حظر SSRF للشبكات الخاصة في `web_fetch` |
| **العزل (M6)** | `TerminalBackend`: `docker` (صورة خفيفة، تركيب workspace فقط) و `ssh` (جهاز آخر) |
| **المهارات المثبّتة** | فحص ثابت + لا تنفيذ تلقائي للسكربتات + عرض المصدر قبل التفعيل |

---

## 16) خطة التنفيذ — المراحل (Milestones)

> **القاعدة:** كل مرحلة تنتهي بشيء **يعمل ويُختبر**، ولا ننتقل قبل استيفاء شرط القبول. **تكلفة كل مرحلة: 0.**

| # | المرحلة | الناتج الملموس | الحجم التقريبي |
|---|---|---|---|
| **M0** | الهيكل والأساس | monorepo + أدوات التطوير + config + logger + mock provider + CI | جلسة واحدة |
| **M1** | النواة + CLI | محادثة حقيقية بالأدوات من الطرفية مع Ollama/Groq | 2–3 جلسات |
| **M2** | Gateway + واجهة الويب | تفتحه من المتصفح/الجوال وتوافق على الأوامر من الواجهة | 2–3 جلسات |
| **M3** | حلقة التعلّم | ذاكرة + بحث جلسات + مهارات ذاتية + سياق مشروع | 2 جلسات |
| **M4** | Telegram | تحادثه من جوالك بنفس الذاكرة | 1–2 جلسة |
| **M5** | الأتمتة | Cron يسلّم لتيليجرام + وكلاء فرعيون | 2 جلسات |
| **M6** | الأمان والعزل | سياسات كاملة + Docker/SSH backends | 1–2 جلسة |
| **M7** | الإضافات والوسائط | MCP + Plugin SDK + Discord + متصفح + صوت + صور | 3+ جلسات |
| **M8** | التوزيع | تثبيت بسطر، Docker، onboarding، ترحيل، توثيق، إصدار 1.0 | 2 جلسات |

### M0 — الهيكل والأساس
- [ ] pnpm workspace: `packages/core`, `packages/cli`, `packages/gateway`, `packages/ui`؛ TypeScript strict ESM؛ `tsconfig.base.json`.
- [ ] أدوات: vitest، tsx (تطوير)، tsup (بناء)، eslint+prettier (خفيف)، `.editorconfig`.
- [ ] `@sindar/core`: محمّل الإعدادات (`config.yaml` + `.env` + متغيرات البيئة) بـ zod، تهيئة `~/.sindar/`، logger (pino) مع حجب الأسرار، طبقة DB + migrations (`node:sqlite`) + اختبار FTS5.
- [ ] واجهة `Provider` + مزود **mock** + قوالب `providers.yaml` (Ollama/Groq/OpenRouter/Gemini/…).
- [ ] CLI هيكلي: `sindar --version`, `sindar doctor` (يفحص Node، المجلد، DB، المزودات المتاحة).
- [ ] GitHub Actions: lint + typecheck + test على Node 22/24.
- [ ] `LICENSE` (MIT)، `CONTRIBUTING.md`، `SECURITY.md`، `.env.example`.
- **قبول:** `pnpm i && pnpm build && pnpm test` ينجح؛ `sindar doctor` يعرض تقريراً صحيحاً على جهازك (Windows/macOS/Linux).

### M1 — النواة + CLI chat
- [ ] مزود `openai-compat` (بث SSE، أدوات، usage) + مزود `anthropic`.
- [ ] Agent Loop كامل (§9) + Context Builder (SOUL/USER/MEMORY/AGENTS.md) + ضغط السياق.
- [ ] سجلّ الأدوات (zod → JSON Schema) + toolsets `files`, `terminal` (local backend)، `web`.
- [ ] محرك سياسات أولي: `ask`/`allowlist`/`yolo` + approval floors + حراسة مسارات.
- [ ] الجلسات في SQLite (إنشاء/استئناف/قائمة) + تسجيل usage.
- [ ] `sindar chat`: بث للطرفية، عرض استدعاءات الأدوات، موافقة تفاعلية، `Ctrl+C` للمقاطعة، أوامر `/new /model /usage /retry /undo /compress /help`.
- [ ] `sindar model` (اختيار مزود/نموذج تفاعلي) و `sindar config get|set`.
- [ ] اختبارات: الحلقة بالـ mock (أدوات متسلسلة، رفض موافقة، ضغط)، الأدوات (ملفات/طرفية)، السياسات.
- **قبول:** على جهازك: `sindar chat` مع Ollama (أو Groq مجاناً) → «اقرأ ملفات هذا المجلد ولخّصها ثم أنشئ ملف NOTES.md» → ينفّذ بالأدوات، يطلب موافقة على الطرفية، والجلسة تُستأنف بعد إعادة التشغيل.

### M2 — Gateway + واجهة الويب
- [ ] Hono: مسارات §12 + WS + توكن + تقديم SPA + `/health`.
- [ ] Event Bus موحّد بين الـ core والـ WS (نفس الأحداث للـ CLI).
- [ ] الواجهة: محادثة بالبث، أدوات قابلة للطي، بطاقة موافقة، قائمة جلسات، مبدّل نموذج، إعدادات، عربي/إنجليزي RTL، داكن/فاتح.
- [ ] `sindar gateway start|stop|status` (+ تشغيل كخدمة: systemd/launchd/Task Scheduler — أساسي)، `sindar dashboard` (يفتح المتصفح بالتوكن).
- **قبول:** من جوالك على نفس الشبكة تفتح الواجهة، ترسل مهمة، ترى الأدوات تعمل، وتوافق على أمر من الجوال.

### M3 — حلقة التعلّم
- [ ] أداة `memory` + nudges + حدود حجم + صفحة الذاكرة في الواجهة.
- [ ] `session_search` (FTS5 + تلخيص اختياري) + `sindar sessions search`.
- [ ] نظام المهارات: محمّل + فهرس + `skills`/`skill_manager` + انعكاس ذاتي بعد المهام المعقدة (أوضاع `ask`/`auto`/`off`) + تحسين عند الفشل.
- [ ] `sindar skills install github:…` + فحص أمني + صفحة المهارات. 3–5 مهارات مضمّنة (مثلاً: git-workflow، تلخيص-مجلد، كتابة-تقرير).
- [ ] `AGENTS.md` كسياق مشروع.
- **قبول:** تقول له «أفضّل الردود المختصرة وأعمل على مشروع X» → جلسة جديدة بعد يوم تُظهر أنه يتذكر؛ `session_search` يجد محادثة الأمس؛ بعد مهمة من 10 خطوات ينشئ مهارة ويستخدمها في المرة التالية بخطوات أقل.

### M4 — Telegram
- [ ] `ChannelAdapter` + Channel Router في الـ Gateway + `@sindar/channel-telegram` (grammY، long polling).
- [ ] الاقتران بكود + allowlist + صفحة القنوات + `sindar pairing list|approve|revoke`.
- [ ] الأوامر، التجزئة، Markdown→HTML، مؤشر الكتابة، تحرير أثناء البث، صور/ملفات، استمرارية الجلسة مع الويب.
- [ ] `sindar gateway setup telegram` (معالج توكن البوت).
- **قبول:** تنشئ بوتاً من BotFather (مجاناً)، تقترن من جوالك، وتسأله عمّا قلته له في الويب أمس فيجيب.

### M5 — الأتمتة والتفويض
- [ ] أداة `cron` + Runner (`croner`) + جلسات معزولة + تسليم للقنوات + صفحة Cron + `sindar cron list|run|pause`.
- [ ] `delegate` (وكلاء فرعيون متوازون) + `todo` + `clarify` + عمليات الخلفية + `send_message`.
- **قبول:** «كل صباح 7:30 أرسل لي ملخص أخبار التقنية» → يصلك على Telegram في الوقت المحدد بتوقيت الرياض؛ مهمة بحث مقسّمة لـ 3 وكلاء فرعيين تنتهي بتقرير موحّد.

### M6 — الأمان والعزل
- [ ] تحسين السياسات: allowlist قابلة للتعلّم («اسمح دائماً»)، approval floors موسّعة، كشف حقن التعليمات في مدخلات القنوات.
- [ ] `TerminalBackend`: `docker` (صورة `sindar-sandbox` خفيفة، تركيب workspace فقط، بلا شبكة اختيارياً) + `ssh`.
- [ ] حدود معدّل لكل مستخدم/قناة، مهلات، حجب الأسرار، تدقيق (`audit log`).
- **قبول:** `rm -rf ~` يُحجَب حتى في `yolo`؛ مع `terminal.backend: docker` الأوامر تعمل داخل الحاوية ولا ترى ملفات النظام.

### M7 — الإضافات والوسائط
- [ ] **MCP client** (stdio + Streamable HTTP) + `sindar mcp add|list|remove` + تسجيل الأدوات ديناميكياً.
- [ ] **Plugin SDK**: إضافات تسجّل أدوات/قنوات/مزودين/hooks؛ تحميل من `~/.sindar/plugins/`.
- [ ] قنوات: **Discord** (discord.js)، **WhatsApp** (Baileys + تحذير)، **Slack** (Bolt).
- [ ] `browser` (Playwright)، `vision` (نماذج متعددة الوسائط)، `stt` (whisper.cpp) + `tts` (Piper/Edge-TTS)، `image_generate` (Pollinations/محلي). رسائل Telegram الصوتية.
- **قبول:** إضافة خادم MCP لنظام الملفات واستخدام أدواته؛ إرسال رسالة صوتية في Telegram والرد عليها نصاً وصوتاً؛ Discord يعمل بنفس الذاكرة.

### M8 — التوزيع والإصدار 1.0
- [ ] `install.sh` / `install.ps1` (يثبت Node إن لزم) + `npm i -g sindar` + `docker compose up`.
- [ ] `sindar onboard`: معالج كامل (مزود → نموذج → اختبار → مساحة العمل → قناة اختيارية → خدمة النظام).
- [ ] `sindar migrate --from openclaw|hermes` (SOUL/MEMORY/USER/المهارات/allowlist/توكن Telegram).
- [ ] توثيق (GitHub Pages)، CHANGELOG، إصدارات موقّعة عبر Actions، PWA للواجهة.
- **قبول:** جهاز نظيف (Windows + Linux) → سطر تثبيت واحد → محادثة خلال 5 دقائق → Telegram خلال 10.

---

## 17) هيكل المستودع

```
SINDAR/
├── PLAN.md  README.md  LICENSE  CONTRIBUTING.md  SECURITY.md  .env.example
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.workspace.ts
├── packages/
│   ├── core/              # @sindar/core   — agent loop, providers, tools, memory, skills, policy, db
│   ├── gateway/           # @sindar/gateway — Hono + WS, channel router, cron runner, static UI
│   ├── cli/               # sindar (bin)    — onboard, chat, gateway, dashboard, model, skills, pairing, cron, doctor, migrate
│   ├── ui/                # @sindar/ui      — React SPA (يُبنى إلى gateway/public)
│   ├── channel-telegram/  # M4
│   ├── channel-discord/   # M7
│   └── plugin-sdk/        # M7
├── skills/                # مهارات مضمّنة (bundled)
├── docs/                  # توثيق + قرارات لاحقة
├── scripts/               # install.sh / install.ps1 (M8)
└── .github/workflows/     # ci.yml, release.yml
```

---

## 18) طريقة عملنا معاً (دورة كل مرحلة)

1. **بداية المرحلة**: ألخّص نطاقها في أسطر وتوافق أو تعدّل.
2. **البناء هنا**: أكتب الكود + اختبارات آلية (بالمزود **mock** لأن بيئة البناء لا تصل لمزودات النماذج) + أرفع commit على الفرع.
3. **اختبارك على جهازك**: تشغّل شرط القبول بنموذج حقيقي (Ollama أو طبقة مجانية) وتخبرني بالنتيجة/الأخطاء.
4. **الإصلاح** ثم **الانتقال** للمرحلة التالية.

> ملاحظة: التصميم يسمح لك باستخدام أي جهاز للاختبار — Windows وmacOS وLinux كلها مدعومة من M0 (Node فقط، بلا تجميع).

---

## 19) المخاطر والتخفيف

| الخطر | الاحتمال | الأثر | التخفيف |
|---|---|---|---|
| النماذج المحلية الصغيرة ضعيفة في استدعاء الأدوات | عالٍ | عالٍ | توصية بنماذج مُختبرة (Qwen3 8B+, Llama 3.x) + سلسلة احتياط لطبقة مجانية سحابية + prompts مبسّطة للأدوات |
| تغيّر حدود الطبقات المجانية | متوسط | متوسط | المزود مجرد إعداد؛ `fallbacks` تلقائية |
| `node:sqlite` تجريبي | منخفض | متوسط | واجهة DB معزولة؛ بديل `better-sqlite3` خلف نفس الواجهة إن لزم |
| حقن التعليمات من القنوات | عالٍ | عالٍ | وسم المدخلات، موافقات، floors، لا جلب روابط تلقائي |
| تمدّد النطاق (النسخ الحرفي لمشروعين ضخمين) | عالٍ | عالٍ | §4 صارم + مراحل بشروط قبول + Plugin SDK لما بعد V1 |
| WhatsApp غير الرسمي قد يُحظر | متوسط | منخفض | ليس قناة أولى + تحذير صريح |
| الأداء على أجهزة ضعيفة/Termux | متوسط | منخفض | لا تبعيات أصلية، تحميل كسول للأدوات والإضافات |

---

## 20) ما بعد V1 (Backlog)

1. تطبيق سطح مكتب (Tauri) وPWA كاملة بإشعارات.
2. قنوات إضافية: Signal, Matrix, Teams, Google Chat, Email, iMessage.
3. Wake word + وضع صوتي مباشر؛ مكالمات صوتية.
4. ذاكرة دلالية (embeddings محلية) إلى جانب FTS5.
5. Canvas / لوحة Kanban للمهام الطويلة؛ لوحة تقارير الفريق.
6. بيئات تنفيذ سحابية (Modal/Daytona) وتعدد المستخدمين بصلاحيات.
7. سوق مهارات/إضافات خاص بـ SINDAR (SindarHub) متوافق مع ClawHub.
8. توليد فيديو/موسيقى، Nodes للأجهزة (كاميرا/شاشة).

---

*الخطة جاهزة. المرحلة التالية: **M0 — الهيكل والأساس**.*
