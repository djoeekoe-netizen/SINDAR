<div align="center">

# SINDAR

**مساعد ذكاء اصطناعي شخصي — مجاني، مفتوح المصدر، يعمل على جهازك ويتعلّم منك.**

يجمع بين معمارية **OpenClaw** (Gateway + واجهة تحكم + قنوات + إضافات) وعقل **Hermes** (ذاكرة + مهارات ذاتية التحسّن + بحث في الجلسات + Cron + وكلاء فرعيون).

عربي أولاً · مجاني أولاً · بياناتك على جهازك · **يعمل على جوال Android وحده (بدون كمبيوتر) أو على أي كمبيوتر**

</div>

---

## 📲 التثبيت (جوال Android عبر Termux، أو Linux/macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/djoeekoe-netizen/SINDAR/arena/ed5f3c48-sindar/scripts/install.sh | bash
```

ثم: `sindar onboard` (اختيار نموذج مجاني ولصق المفتاح) ← `sindar chat`. الدليل خطوة بخطوة للجوال في **[docs/termux.md](./docs/termux.md)**.
على الكمبيوتر يكفي Node.js ≥ 22.13 ثم نفس السطر (بدون `pkg install`).

## 🚧 الحالة

المشروع في بداية التنفيذ. الخطة الكاملة في **[PLAN.md](./PLAN.md)**.

| المرحلة | الناتج | الحالة |
|---|---|---|
| **M0** | الهيكل والأساس (monorepo، config، DB، mock provider، CI، سكربت تثبيت Termux، `sindar doctor`) | ✅ |
| **M1** | النواة + CLI — `sindar onboard` و`sindar chat` بالأدوات (ملفات، طرفية، ويب) مع موافقات | ✅ (قيد الاختبار على الجوال) |
| **M2** | Gateway + واجهة ويب/PWA عربية/إنجليزية — تُستخدم كتطبيق من الشاشة الرئيسية | ⬜ |
| **M3** | حلقة التعلّم — ذاكرة، بحث جلسات، مهارات ذاتية | ⬜ |
| **M4** | قناة Telegram | ⬜ |
| **M5** | **تطبيق Android (APK)** + تطبيق سطح المكتب (Windows/macOS/Linux) | ⬜ |
| **M6** | Cron + وكلاء فرعيون + أدوات الجوال (إشعارات، مشاركة…) | ⬜ |
| **M7** | الأمان والعزل (Docker/SSH) | ⬜ |
| **M8** | MCP، Plugin SDK، Discord، متصفح، صوت، صور، أدوات Android الكاملة | ⬜ |
| **M9** | التثبيت بسطر واحد، onboarding، ترحيل، إصدار 1.0 | ⬜ |

## 📱 بدون كمبيوتر؟

نعم. العقل يعمل داخل جوالك عبر **Termux** (مجاني)، وتستخدمه من تطبيق SINDAR على نفس الجوال. ولو كان عندك كمبيوتر فنفس البرنامج يعمل عليه، وتربط الجوال به بمسح QR. التفاصيل في [PLAN.md §5.1](./PLAN.md).

## 💸 هل يكلّف شيئاً؟

**لا.** الكود والمكتبات والتشغيل على جهازك وTelegram كلها مجانية. النموذج اللغوي يعمل محلياً عبر **Ollama** مجاناً، أو عبر طبقات مجانية سحابية (Groq، Gemini، OpenRouter…). المزودون المدفوعون **اختياريون** دائماً. التفاصيل في [PLAN.md §3](./PLAN.md#3-مبدأ-مجاني-أولاً--جدول-التكلفة).

## ⚙️ التقنيات

TypeScript · Node.js 22+ · SQLite مدمج (FTS5، مع بديل sql.js تلقائي) · Hono · React · grammY

## 🛠️ للمطورين

```bash
pnpm install && pnpm build && pnpm test
node packages/cli/dist/index.js doctor
```
الهيكل: `packages/core` (النواة) · `packages/cli` (`sindar`) · `packages/gateway` (M2) · `packages/ui` (M2). انظر [CONTRIBUTING.md](./CONTRIBUTING.md).

## 📄 الرخصة

MIT
