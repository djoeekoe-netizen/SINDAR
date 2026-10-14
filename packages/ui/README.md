# @sindar/ui

واجهة SINDAR (ويب + PWA) — **Preact + @preact/signals + Vite**. تُبنى إلى `packages/cli/ui/` ويقدّمها الـ Gateway على `/`، وتُشحن داخل حزمة `sindar` نفسها. لاحقاً تُغلَّف بـ Tauri كتطبيق Android وسطح مكتب (M5).

## التطوير

```bash
# في طرفية: شغّل العقل
SINDAR_HOME=/tmp/sindar-dev node packages/cli/dist/index.js gateway start --foreground
# في طرفية أخرى: خادم Vite مع تمرير /api و /ws إلى الـ gateway
SINDAR_GATEWAY_URL=http://127.0.0.1:18789 pnpm --filter @sindar/ui dev
```

ثم افتح الرابط الذي يطبعه Vite مع `?token=<الرمز من sindar gateway token>`.

## البنية

| المسار | المحتوى |
|---|---|
| `src/lib/api.ts` | عميل REST (`Api`) + حفظ الاتصال في `localStorage` |
| `src/lib/ws.ts` | `GatewaySocket`: اتصال WebSocket مع إعادة محاولة تصاعدية ونبض كل 30 ث |
| `src/lib/store.ts` | الحالة كلها كـ signals + معالجة رسائل الخادم + الإجراءات |
| `src/lib/i18n.ts` | النصوص عربي/إنجليزي |
| `src/lib/markdown.ts` | Markdown → HTML مُعقَّم (DOMPurify) |
| `src/components/` | شاشة الاتصال، المحادثة، البطاقات (مستخدم/مساعد/أداة/موافقة)، المؤلّف، الجلسات، مبدّل النموذج، الإعدادات |
| `public/` | `manifest.webmanifest`، `sw.js` (قشرة التطبيق فقط — لا يخزّن `/api` أو `/ws`)، الأيقونات |

أنواع البروتوكول تُستورد مباشرة من `packages/gateway/src/protocol.ts` (مصدر واحد للحقيقة).
