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
| **أين يعمل** | **على جوال Android وحده (بدون كمبيوتر) عبر Termux** — أو على أي كمبيوتر (Windows/macOS/Linux) — أو على خادم مجاني. نفس البرنامج في الحالات الثلاث |
| **شكل V1** | **العقل (Gateway)** + **تطبيق Android** (APK) + **واجهة ويب/PWA** (عربي/إنجليزي، RTL) + **CLI** + قناة **Telegram** + تطبيق سطح مكتب |
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
7. **يعمل كاملاً على جوال Android بلا كمبيوتر**: تثبيت بأمر واحد في Termux، ثم استخدام من تطبيق على نفس الجوال.
8. من جهاز آخر (كمبيوتر/جوال ثانٍ) تتصل بنفس «العقل» بمسح رمز QR في أقل من دقيقة.

### مبدأ «عقل واحد، شاشات كثيرة»
- **العقل (Gateway)** يعمل حيث تريد: **على الجوال نفسه عبر Termux** (الوضع الأساسي لمن لا يملك كمبيوتر)، أو على الكمبيوتر، أو على خادم مجاني.
- **الشاشات** = تطبيق سطح المكتب، تطبيق Android، المتصفح، الطرفية، Telegram — كلها تتصل بنفس العقل، فالذاكرة والمحادثات واحدة في كل مكان.

---

## 1) ماذا نأخذ من كلٍّ منهما

| الميزة | المصدر | في SINDAR | المرحلة |
|---|---|---|---|
| Gateway محلي = مركز تحكم للجلسات/الأدوات/القنوات | OpenClaw | `@sindar/gateway` | M2 |
| Control UI ويب | OpenClaw | React SPA يخدمها الـ Gateway نفسه (+ PWA للجوال) | M2 |
| **يعمل على Android عبر Termux** (العقل داخل الجوال) | Hermes (حزمة Termux رسمية) | سكربت تثبيت بأمر واحد لـ Termux + توافق كامل مع بيئته | M1 |
| **تطبيقات أصلية** (Android + سطح مكتب) تتصل بالـ Gateway | OpenClaw | **Tauri 2**: نفس واجهة React تُغلَّف كـ APK لأندرويد وتطبيق Windows/macOS/Linux؛ اقتران بـ QR | M5 |
| قدرات الجهاز من الجوال (إشعارات، مشاركة، صوت، كاميرا، SMS، موقع) — «Nodes» | OpenClaw | مجموعة أدوات `android` عبر Termux:API + إضافات Tauri | M6/M8 |
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

**ما لن ننسخه في V1 (بوعي):** تطبيق iOS (يحتاج جهاز Mac + حساب Apple بـ 99$/سنة — ليس مجانياً)، مكالمات صوتية وبوتات اجتماعات، 20+ قناة، 100+ مزود، توليد فيديو/موسيقى، بيئات Modal/Daytona السحابية. (مؤجلة لـ §20.)

---

## 2) القرارات المعمارية (ADRs)

| # | القرار | البدائل المرفوضة | السبب |
|---|---|---|---|
| **ADR-01** | **TypeScript / Node.js ≥ 22.12** للنواة والـ Gateway والواجهة | Python (Hermes)، هجين | لغة واحدة = تشغيل أبسط للمستخدم (`npm i -g`)، نفس اللغة للواجهة، نظام npm غني بمكتبات القنوات (grammY, discord.js, Baileys) |
| **ADR-02** | **SQLite** خلف واجهة صغيرة: `node:sqlite` المدمج (تحقّقنا: FTS5 يعمل، إصدار 3.51) مع **بديل `sql.js` (WASM)** تلقائياً إن لم يتوفر (Termux/WebView) | better-sqlite3 (يحتاج تجميع)، Postgres، LanceDB | **صفر تبعيات أصلية** على كل المنصات بما فيها الجوال، ملف واحد، FTS5 للبحث النصي |
| **ADR-03** | **Monorepo بـ pnpm workspaces** | حزمة واحدة، npm workspaces | فصل واضح core/gateway/cli/ui/channels، نشر حزم مستقلة لاحقاً |
| **ADR-04** | **مزود OpenAI-compatible** (fetch + SSE) كمحوّل عام + **Anthropic** أصلي + **mock** للاختبارات | SDK لكل مزود، Vercel AI SDK | واجهة `/v1/chat/completions` تغطي: Ollama، LM Studio، llama.cpp، vLLM، OpenRouter، Groq، Gemini (نقطة التوافق)، Mistral، DeepSeek، xAI، GitHub Models، Cerebras — بمحوّل واحد |
| **ADR-05** | **ملفات نصية** للهوية والذاكرة (`SOUL.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`) + **SQLite** للجلسات/البحث/Cron/الموافقات | كل شيء في DB | الملفات يقرأها ويعدّلها المستخدم، قابلة للنسخ الاحتياطي بـ git، ومتوافقة مع OpenClaw/Hermes للترحيل |
| **ADR-06** | **Telegram أولاً** عبر **long polling** | WhatsApp، Discord | مجاني، بدون دومين/HTTPS/IP عام، API رسمي مستقر، صفر خطر حظر |
| **ADR-07** | **Gateway موثوق / تنفيذ غير موثوق** + موافقات افتراضية على الطرفية والكتابة خارج مساحة العمل | yolo افتراضي | رسائل القنوات مدخلات غير موثوقة؛ نسخ مبدأ OpenClaw الأمني |
| **ADR-08** | الواجهة **SPA ثابتة يخدمها الـ Gateway** على نفس المنفذ | سيرفر منفصل، SSR | عملية واحدة، منفذ واحد، لا CORS، تعمل من الجوال على نفس الشبكة |
| **ADR-09** | **مجاني أولاً**: كل ميزة لها **مسار مجاني افتراضي** وأي مزود مدفوع اختياري | الاعتماد على API مدفوع | متطلب المنتج الأساسي |
| **ADR-10** | **التوافق مع المعايير المفتوحة**: مهارات agentskills.io (`SKILL.md`)، MCP، OpenAI tool-calling schema | صيغ خاصة | تثبيت مهارات جاهزة من ClawHub/GitHub، واستخدام آلاف خوادم MCP |
| **ADR-11** | **الإعدادات**: `~/.sindar/config.yaml` (غير سرّي) + `~/.sindar/.env` (المفاتيح) | ملف واحد | المفاتيح لا تختلط بالإعدادات القابلة للمشاركة |
| **ADR-12** | **التطبيقات عبر Tauri 2**: مشروع واحد يبني تطبيق سطح المكتب (Windows/macOS/Linux) **و** Android (APK) من نفس واجهة React | Electron (سطح مكتب فقط، ثقيل)، Capacitor (جوال فقط)، React Native (واجهة ثانية) | كود واجهة واحد لكل المنصات، حجم صغير، مجاني، وتُبنى الحزم تلقائياً في GitHub Actions |
| **ADR-13** | **الواجهة عميل مستقل**: تتصل بأي Gateway عبر «عنوان + توكن»، والاقتران بمسح **QR** | واجهة مرتبطة بسيرفر واحد | نفس الواجهة تعمل من المتصفح والتطبيق المكتبي وAndroid ومع عقل محلي أو بعيد |
| **ADR-14** | **سطح المكتب يحزم العقل داخله** (Gateway كـ sidecar: Node مُجمَّع في ملف تنفيذي واحد عبر `pkg`/SEA) | مطالبة المستخدم بتثبيت Node | المستخدم يثبّت برنامجاً واحداً ويعمل كل شيء |
| **ADR-15** | **Android = منصة أساسية للعقل عبر Termux**: Node.js يعمل أصلاً داخل Termux (مجاني، من F-Droid)، وتطبيق SINDAR (APK) يتصل بالعقل المحلي `127.0.0.1` تلقائياً أو بعقل بعيد. تشغيل العقل **داخل** الـ APK نفسه بلا Termux = تجريبي لاحقاً (§20) | عقل داخل الـ APK من البداية | Termux طريق مُثبت (Hermes يستخدمه رسمياً)، أما حزم Node داخل APK فعمل نظامي عميق لا يمكن اختباره إلا على أجهزة حقيقية |
| **ADR-16** | **قواعد توافق Termux** إلزامية من M0: لا مسارات ثابتة (`/bin/sh`, `/tmp`) بل `$PREFIX`/`$TMPDIR`/`process.env.SHELL`؛ اكتشاف Termux تلقائياً؛ `termux-wake-lock` للخلفية؛ Termux:API كأدوات اختيارية | التعامل معه لاحقاً | المستخدم الأول للمشروع يعمل من الجوال فقط |

---

## 3) مبدأ «مجاني أولاً» — جدول التكلفة

| البند | التكلفة | المسار المجاني الافتراضي | البديل المدفوع (اختياري) |
|---|---|---|---|
| كود SINDAR وكل المكتبات | **0** | MIT + npm | — |
| GitHub (كود، CI، إصدارات، توثيق) | **0** | Actions + Pages | — |
| التشغيل | **0** | لابتوب/PC/Raspberry Pi/جوال Termux | VPS ~15–20 ريال/شهر أو Oracle Cloud Always Free |
| **تطبيق سطح المكتب** | **0** | Tauri + Rust (مجانية) تُبنى في GitHub Actions → تحمّل المثبّت من GitHub Releases | توقيع الشهادات لـ Windows/macOS (اختياري — بدونه تظهر رسالة «ناشر غير معروف» فقط) |
| **العقل على الجوال** | **0** | **Termux** + Termux:API + Termux:Boot (كلها مجانية من F-Droid) — بدون كمبيوتر إطلاقاً | — |
| **تطبيق Android** | **0** | APK يُبنى في GitHub Actions، تثبّته مباشرة على جوالك (أو عبر F-Droid/Obtainium) | نشره في Google Play: 25$ **مرة واحدة** — اختياري فقط لو أردت نشره للناس |
| **تشغيل 24/7** | **0** | الجوال نفسه (Termux + wake-lock + تشغيل مع الإقلاع) **أو** Oracle Cloud Always Free | VPS مدفوع |
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
- Gateway: HTTP + WebSocket، توكن وصول، واجهة ويب عربية/إنجليزية RTL، موافقات من الواجهة، PWA.
- **التشغيل على Android عبر Termux**: سكربت تثبيت بأمر واحد، تشغيل في الخلفية مع الإقلاع، أدوات الجهاز (إشعارات، مشاركة، صوت، كاميرا، SMS، موقع، حافظة) عبر Termux:API.
- **تطبيق Android** (APK): يكتشف العقل المحلي تلقائياً أو يقترن بعقل بعيد بـ QR، محادثة كاملة، إشعارات الموافقات والـ Cron، «مشاركة إلى SINDAR»، إدخال صوتي، إرسال صور من الكاميرا.
- **تطبيق سطح مكتب** (Windows/macOS/Linux) يحزم العقل داخله + أيقونة في شريط النظام + تشغيل تلقائي.
- CLI: `onboard`, `chat`, `gateway`, `dashboard`, `model`, `skills`, `pairing`, `cron`, `doctor`, `migrate`.
- Telegram: اقتران، allowlist، أوامر slash، تجزئة الرسائل، مؤشر الكتابة، استمرارية الجلسة مع الويب.
- Cron: جدولة بلغة طبيعية + تسليم للقنوات. وكلاء فرعيون متوازون. قائمة مهام.
- الأمان: أوضاع موافقة (`ask` / `allowlist` / `yolo`) + حدود دنيا للأوامر الخطرة + حراسة المسارات + Docker backend.
- MCP client، Plugin SDK، Discord، متصفح، صوت، صور (M7) — بمسارات مجانية.
- تثبيت بسطر واحد، Docker Compose، ترحيل من OpenClaw/Hermes.

### ❌ خارج النطاق (مؤجل لما بعد V1)
- تطبيق iOS (غير مجاني: يحتاج Mac + حساب Apple 99$/سنة) — الواجهة ستعمل على iPhone من المتصفح كـ PWA.
- تشغيل العقل **داخل** ملف الـ APK نفسه بلا Termux (تجريبي بعد V1 — §20).
- مكالمات صوتية، بوتات اجتماعات، wake word.
- توليد فيديو/موسيقى، بيئات سحابية (Modal/Daytona).
- تعدد المستأجرين (multi-tenant) وفرق كبيرة بصلاحيات معقدة.
- تدريب نماذج / توليد Trajectories.

---

## 5) المعمارية

```
┌──────────────────────────────── الشاشات (عملاء) ────────────────────────────────┐
│ تطبيق سطح المكتب │ تطبيق Android │ المتصفح / PWA │ CLI / TUI          │ Telegram │
│ (Tauri + عقل مدمج)│ (Tauri, APK)  │ (React SPA)   │ (sindar chat)      │          │
└────────┬─────────┴───────┬───────┴───────┬───────┴─────────┬──────────┴────┬─────┘
         │  WS/HTTP + token (محلي أو عبر Tailscale)          │ in-process    │ Bot API
┌────────▼─────────────────▼───────────────▼─────────────────▼───────────────▼─────┐
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

### 5.1 أين يعمل العقل؟ — ثلاثة أوضاع، برنامج واحد

| الوضع | لمن؟ | كيف؟ | ما يتصل به |
|---|---|---|---|
| **A. على الجوال** (الأساسي) | من لا يملك كمبيوتر | Termux (مجاني من F-Droid) → أمر تثبيت واحد → `sindar onboard` → يعمل في الخلفية مع wake-lock وTermux:Boot | تطبيق SINDAR على نفس الجوال (يكتشف `127.0.0.1` تلقائياً)، المتصفح، Telegram |
| **B. على الكمبيوتر** | من يملك كمبيوتر | `npm i -g sindar` أو تطبيق سطح المكتب (العقل مدمج) | تطبيق سطح المكتب، المتصفح، تطبيق Android عبر QR (شبكة منزلية أو Tailscale)، Telegram |
| **C. على خادم مجاني** | من يريد 24/7 بلا قلق من البطارية | Oracle Cloud Always Free / أي VPS + Tailscale | كل الأجهزة + Telegram |

**ملاحظات الوضع A (Termux) — ما يجب أن يعرفه المستخدم:**
- تثبيت Termux من **F-Droid** أو GitHub (نسخة Google Play قديمة ومعطّلة).
- النماذج: الأفضل على الجوال **طبقة مجانية سحابية** (Groq / Gemini / OpenRouter) — سريعة ولا تستهلك البطارية. النماذج المحلية الصغيرة (1–3B عبر Ollama في Termux) ممكنة على جوال بذاكرة 8GB لكنها بطيئة.
- إيقاف «تحسين البطارية» لـ Termux حتى لا يقتله النظام في الخلفية (نشرح ذلك في `sindar doctor`).
- أدوات الجهاز (إشعارات، SMS، كاميرا، موقع…) تحتاج تطبيق **Termux:API** المجاني + منح الأذونات.

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

**الواجهة** (React + Vite + Tailwind) — **عميل واحد لكل المنصات** (ADR-13): عربية RTL افتراضياً + إنجليزية، وضع داكن، قائمة الجلسات، محادثة بالبث مع عرض استدعاءات الأدوات قابلة للطي، **بطاقة موافقة** مضمّنة في المحادثة، مبدّل نموذج، صفحات: الذاكرة (تحرير MEMORY/USER)، المهارات، Cron، القنوات/الاقتران، الأجهزة المتصلة، الإعدادات.
- **شاشة الاتصال**: عنوان الـ Gateway + توكن، أو **مسح QR** يعرضه تطبيق سطح المكتب/الأمر `sindar dashboard --qr`. يدعم أكثر من عقل (منزل/عمل).
- **PWA** من M2: تُضاف للشاشة الرئيسية على أي جوال (بما فيها iPhone) قبل وجود التطبيق الأصلي.
- نفس الكود يُغلَّف في **M5** بـ Tauri 2 ليصبح تطبيق سطح مكتب وتطبيق Android.

### 12.1 التطبيقات (M5) — Tauri 2
| | تطبيق سطح المكتب | تطبيق Android |
|---|---|---|
| **المحتوى** | الواجهة + **العقل مدمج** (Gateway كـ sidecar) | الواجهة؛ تتصل بالعقل **على نفس الجوال** (Termux، تلقائياً) أو بعقل بعيد (QR) |
| **المنصات** | Windows (`.msi`/`.exe`)، macOS (`.dmg`)، Linux (`.AppImage`/`.deb`) | `APK` (Android 8+) |
| **خاص بالمنصة** | أيقونة شريط النظام، تشغيل مع الإقلاع، عرض QR للاقتران، فتح مجلد العمل | زر «تشغيل العقل» (يفتح Termux بأمر التشغيل إن كان متوقفاً)، إشعارات (موافقات/Cron)، «مشاركة إلى SINDAR»، إدخال صوتي، كاميرا/معرض، الاحتفاظ بالاتصال في الخلفية |
| **البناء** | GitHub Actions (`tauri-action`) → GitHub Releases | GitHub Actions → APK موقّع بمفتاح المشروع → Releases |
| **التحديث** | مُحدِّث Tauri المدمج من Releases | إشعار بإصدار جديد + رابط (أو Obtainium) |

> **ملاحظة تنفيذية:** بيئة البناء التي أعمل فيها لا تستطيع تجميع Rust/Android (المصادر محجوبة)، لذلك أكتب الكود والإعدادات هنا، و**GitHub Actions المجاني يبني الحزم**؛ تحمّلها أنت من صفحة Releases وتختبرها على جهازك وجوالك.

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
| **M5** | **التطبيقات** | **برنامج للكمبيوتر** (Windows/macOS/Linux) + **تطبيق Android** (APK) + اقتران QR | 3 جلسات |
| **M6** | الأتمتة | Cron يسلّم لتيليجرام/التطبيق + وكلاء فرعيون | 2 جلسات |
| **M7** | الأمان والعزل | سياسات كاملة + Docker/SSH backends | 1–2 جلسة |
| **M8** | الإضافات والوسائط | MCP + Plugin SDK + Discord + متصفح + صوت + صور + قدرات جهاز Android | 3+ جلسات |
| **M9** | التوزيع | تثبيت بسطر، Docker، onboarding، ترحيل، Termux، توثيق، إصدار 1.0 | 2 جلسات |

### M0 — الهيكل والأساس
- [ ] pnpm workspace: `packages/core`, `packages/cli`, `packages/gateway`, `packages/ui`؛ TypeScript strict ESM؛ `tsconfig.base.json`.
- [ ] أدوات: vitest، tsx (تطوير)، tsup (بناء)، eslint+prettier (خفيف)، `.editorconfig`.
- [ ] `@sindar/core`: محمّل الإعدادات (`config.yaml` + `.env` + متغيرات البيئة) بـ zod، تهيئة `~/.sindar/`، logger (pino) مع حجب الأسرار، طبقة DB + migrations (`node:sqlite`) + اختبار FTS5.
- [ ] واجهة `Provider` + مزود **mock** + قوالب `providers.yaml` (Ollama/Groq/OpenRouter/Gemini/…).
- [ ] CLI هيكلي: `sindar --version`, `sindar doctor` (يفحص Node، المجلد، DB، المزودات المتاحة، **ويكتشف Termux** ويعرض نصائح البطارية/التخزين).
- [ ] طبقة منصة `platform.ts`: اكتشاف Termux/Windows/macOS/Linux، مسارات (`$PREFIX`, `$TMPDIR`)، الصدَفة الافتراضية — بلا مسارات ثابتة (ADR-16).
- [ ] **`scripts/install-termux.sh`** (نسخة أولى): يثبّت `nodejs-lts` و`git` في Termux، يجلب آخر بناء من GitHub، ويضع أمر `sindar` في المسار.
- [ ] GitHub Actions: lint + typecheck + test على Node 22/24.
- [ ] `LICENSE` (MIT)، `CONTRIBUTING.md`، `SECURITY.md`، `.env.example`.
- **قبول:** `pnpm i && pnpm build && pnpm test` ينجح في CI؛ **على جوالك**: أمر تثبيت واحد في Termux ثم `sindar doctor` يعرض تقريراً صحيحاً (ويعمل أيضاً على Windows/macOS/Linux).

### M1 — النواة + CLI chat
- [ ] مزود `openai-compat` (بث SSE، أدوات، usage) + مزود `anthropic`.
- [ ] Agent Loop كامل (§9) + Context Builder (SOUL/USER/MEMORY/AGENTS.md) + ضغط السياق.
- [ ] سجلّ الأدوات (zod → JSON Schema) + toolsets `files`, `terminal` (local backend)، `web`.
- [ ] محرك سياسات أولي: `ask`/`allowlist`/`yolo` + approval floors + حراسة مسارات.
- [ ] الجلسات في SQLite (إنشاء/استئناف/قائمة) + تسجيل usage.
- [ ] `sindar chat`: بث للطرفية، عرض استدعاءات الأدوات، موافقة تفاعلية، `Ctrl+C` للمقاطعة، أوامر `/new /model /usage /retry /undo /compress /help`.
- [ ] `sindar model` (اختيار مزود/نموذج تفاعلي) و `sindar config get|set`.
- [ ] اختبارات: الحلقة بالـ mock (أدوات متسلسلة، رفض موافقة، ضغط)، الأدوات (ملفات/طرفية)، السياسات.
- [ ] توافق Termux مُختبر: `terminal` يستخدم صدَفة Termux، الملفات في `~/storage/shared` بعد `termux-setup-storage`، `sindar onboard` يقترح مزوداً مجانياً (Groq/Gemini/OpenRouter) ويختبر المفتاح.
- **قبول:** **على جوالك داخل Termux**: `sindar chat` مع مفتاح Groq المجاني (أو Gemini) → «اقرأ ملفات هذا المجلد ولخّصها ثم أنشئ ملف NOTES.md» → ينفّذ بالأدوات، يطلب موافقة، والجلسة تُستأنف بعد إعادة التشغيل.

### M2 — Gateway + واجهة الويب
- [ ] Hono: مسارات §12 + WS + توكن + تقديم SPA + `/health`.
- [ ] Event Bus موحّد بين الـ core والـ WS (نفس الأحداث للـ CLI).
- [ ] الواجهة: محادثة بالبث، أدوات قابلة للطي، بطاقة موافقة، قائمة جلسات، مبدّل نموذج، إعدادات، عربي/إنجليزي RTL، داكن/فاتح.
- [ ] الواجهة كعميل مستقل: شاشة اتصال (عنوان + توكن)، **QR** من `sindar dashboard --qr`، PWA (manifest + service worker + أيقونة).
- [ ] `sindar gateway start|stop|status` (+ تشغيل كخدمة: systemd/launchd/Task Scheduler — أساسي)، `sindar dashboard` (يفتح المتصفح بالتوكن).
- [ ] تشغيل الخلفية على Termux: `sindar gateway start` يأخذ `termux-wake-lock`، ويعمل مع الإقلاع عبر Termux:Boot (اختياري).
- **قبول:** **على جوالك**: `sindar gateway start` في Termux → تفتح `http://127.0.0.1:18789` في المتصفح → تضيفها للشاشة الرئيسية (تصبح مثل تطبيق) → ترسل مهمة، ترى الأدوات تعمل، وتوافق على أمر — ثم تقفل Termux وتعود للواجهة فتجدها تعمل.

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

### M5 — التطبيقات: Android + سطح المكتب
- [ ] مشروع Tauri 2 في `apps/sindar-app/` يستخدم `packages/ui` كواجهة؛ أهداف: Windows، macOS، Linux، Android.
- [ ] **سطح المكتب**: حزم الـ Gateway كـ sidecar (Node مُجمَّع عبر `pkg`/SEA)، تشغيل/إيقاف العقل من التطبيق، أيقونة شريط النظام، تشغيل مع الإقلاع، نافذة QR للاقتران، فتح مجلد العمل.
- [ ] **Android**: اكتشاف العقل المحلي (`127.0.0.1:18789`) تلقائياً + زر «تشغيل العقل» (يفتح Termux بالأمر)، شاشة الاقتران بالكاميرا (QR) لعقل بعيد، حفظ أكثر من عقل، إشعارات محلية للموافقات ونتائج Cron، «مشاركة إلى SINDAR» (نص/رابط/صورة)، إدخال صوتي بلوحة المفاتيح، إعادة اتصال تلقائي.
- [ ] الوصول من خارج المنزل: دليل Tailscale (مجاني) + اختبار أن التطبيق يعمل عبره.
- [ ] GitHub Actions: `release.yml` يبني المثبّتات والـ APK (موقّع بمفتاح المشروع) وينشرها في Releases عند كل وسم إصدار؛ مُحدِّث Tauri لسطح المكتب.
- [ ] الترتيب داخل المرحلة: **Android APK أولاً** (لأنه جهازك)، ثم سطح المكتب.
- **قبول:** تحمّل APK من Releases على جوالك → يكتشف العقل في Termux تلقائياً → تحادثه كتطبيق عادي، وتصلك إشعار موافقة عندما يطلب الوكيل تنفيذ أمر؛ ثم (لمن يملك كمبيوتر) مثبّت Windows يعمل بلا تثبيت Node ويقترن بالجوال عبر QR.

### M6 — الأتمتة والتفويض
- [ ] أداة `cron` + Runner (`croner`) + جلسات معزولة + تسليم للقنوات والتطبيقات + صفحة Cron + `sindar cron list|run|pause`.
- [ ] `delegate` (وكلاء فرعيون متوازون) + `todo` + `clarify` + عمليات الخلفية + `send_message`.
- [ ] مجموعة أدوات `android` (أساسية) عبر Termux:API: `notify`, `clipboard`, `share`, `battery`, `tts` — وتسليم Cron كإشعار على الجوال.
- **قبول:** «كل صباح 7:30 أرسل لي ملخص أخبار التقنية» → يصلك إشعار على جوالك وعلى Telegram في الوقت المحدد بتوقيت الرياض؛ مهمة بحث مقسّمة لـ 3 وكلاء فرعيين تنتهي بتقرير موحّد.

### M7 — الأمان والعزل
- [ ] تحسين السياسات: allowlist قابلة للتعلّم («اسمح دائماً»)، approval floors موسّعة، كشف حقن التعليمات في مدخلات القنوات.
- [ ] `TerminalBackend`: `docker` (صورة `sindar-sandbox` خفيفة، تركيب workspace فقط، بلا شبكة اختيارياً) + `ssh`.
- [ ] حدود معدّل لكل مستخدم/قناة، مهلات، حجب الأسرار، تدقيق (`audit log`).
- **قبول:** `rm -rf ~` يُحجَب حتى في `yolo`؛ مع `terminal.backend: docker` الأوامر تعمل داخل الحاوية ولا ترى ملفات النظام.

### M8 — الإضافات والوسائط
- [ ] **MCP client** (stdio + Streamable HTTP) + `sindar mcp add|list|remove` + تسجيل الأدوات ديناميكياً.
- [ ] **Plugin SDK**: إضافات تسجّل أدوات/قنوات/مزودين/hooks؛ تحميل من `~/.sindar/plugins/`.
- [ ] قنوات: **Discord** (discord.js)، **WhatsApp** (Baileys + تحذير)، **Slack** (Bolt).
- [ ] `browser` (Playwright — على الكمبيوتر/الخادم؛ على Termux بديل خفيف عبر `web_fetch` المتقدم)، `vision` (نماذج متعددة الوسائط)، `stt` (whisper.cpp / خدمة مجانية) + `tts` (Piper/Edge-TTS/Termux TTS)، `image_generate` (Pollinations/محلي). رسائل Telegram الصوتية.
- [ ] مجموعة `android` الكاملة عبر Termux:API: `sms` (قراءة/إرسال بإذن)، `camera`, `location`, `contacts`, `call_log`, `torch`, `vibrate`, `wifi` — كل أداة لها خطر محدد وموافقة.
- **قبول:** إضافة خادم MCP لنظام الملفات واستخدام أدواته؛ إرسال رسالة صوتية في Telegram والرد عليها نصاً وصوتاً؛ Discord يعمل بنفس الذاكرة.

### M9 — التوزيع والإصدار 1.0
- [ ] `install.sh` (يكتشف Termux تلقائياً ويثبّت `nodejs-lts` + `termux-api`) / `install.ps1` + `npm i -g sindar` + `docker compose up`؛ ملف `.deb` لمستودع Termux (اختياري).
- [ ] `sindar onboard`: معالج كامل (مزود → نموذج → اختبار → مساحة العمل → قناة اختيارية → خدمة النظام).
- [ ] `sindar migrate --from openclaw|hermes` (SOUL/MEMORY/USER/المهارات/allowlist/توكن Telegram).
- [ ] توثيق (GitHub Pages)، CHANGELOG، إصدارات موقّعة عبر Actions، PWA للواجهة.
- **قبول:** **جوال Android نظيف** (Termux فقط) → سطر تثبيت واحد → محادثة خلال 5 دقائق → التطبيق + Telegram خلال 10؛ ونفس الشيء على Windows وLinux.

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
├── apps/
│   └── sindar-app/        # Tauri 2 — تطبيق Android (APK) + سطح المكتب، يستخدم packages/ui (M5)
├── skills/                # مهارات مضمّنة (bundled)
├── docs/                  # توثيق + دليل Termux + قرارات لاحقة
├── scripts/               # install-termux.sh (M0) · install.sh / install.ps1 (M9)
└── .github/workflows/     # ci.yml, release.yml
```

---

## 18) طريقة عملنا معاً (دورة كل مرحلة)

1. **بداية المرحلة**: ألخّص نطاقها في أسطر وتوافق أو تعدّل.
2. **البناء هنا**: أكتب الكود + اختبارات آلية (بالمزود **mock** لأن بيئة البناء لا تصل لمزودات النماذج) + أرفع commit على الفرع.
3. **اختبارك من جوالك**: (أ) للواجهة — أشغّل نسخة تجريبية هنا وأعطيك رابطاً تفتحه من متصفح الجوال فوراً (بمزود mock)؛ (ب) للتجربة الحقيقية — تحدّث SINDAR داخل Termux بأمر واحد (`sindar update` أو سطر التثبيت) وتجرّب شرط القبول بمفتاح مجاني (Groq/Gemini) وتخبرني بالنتيجة أو تلصق لي رسالة الخطأ.
4. **الإصلاح** ثم **الانتقال** للمرحلة التالية.

> ملاحظة: لا تحتاج كمبيوتر في أي مرحلة. حزم التطبيقات (APK/مثبّتات) يبنيها GitHub Actions مجاناً وتحمّلها من صفحة Releases على جوالك.

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
| النظام يقتل Termux في الخلفية (Xiaomi/Samsung/Huawei) | عالٍ | متوسط | wake-lock + إشعار دائم + دليل إيقاف تحسين البطارية في `doctor` + إعادة تشغيل تلقائية عبر Termux:Boot |
| `node:sqlite` غير متاح في Node الخاص بـ Termux | متوسط | منخفض | بديل `sql.js` تلقائي خلف نفس الواجهة (ADR-02) |
| لا أستطيع اختبار Termux/Android في بيئة البناء | مؤكد | متوسط | قواعد ADR-16 + اختبارات آلية لطبقة المنصة + اختبارك المبكر من M0 على جوالك |

---

## 20) ما بعد V1 (Backlog)

1. **عقل داخل الـ APK بلا Termux** (حزم Node داخل التطبيق) — تجريبي؛ وتطبيق iOS (يحتاج Mac + 99$/سنة).
2. قنوات إضافية: Signal, Matrix, Teams, Google Chat, Email, iMessage.
3. Wake word + وضع صوتي مباشر؛ مكالمات صوتية.
4. ذاكرة دلالية (embeddings محلية) إلى جانب FTS5.
5. Canvas / لوحة Kanban للمهام الطويلة؛ لوحة تقارير الفريق.
6. بيئات تنفيذ سحابية (Modal/Daytona) وتعدد المستخدمين بصلاحيات.
7. سوق مهارات/إضافات خاص بـ SINDAR (SindarHub) متوافق مع ClawHub.
8. توليد فيديو/موسيقى، Nodes للأجهزة (كاميرا/شاشة).

---

*الخطة جاهزة (نسخة «الجوال أولاً»). المرحلة التالية: **M0 — الهيكل والأساس**.*
