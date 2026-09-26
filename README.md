<div align="center">

# 🕌 SINDAR — Islamic Shorts Creator

**منشئ مقاطع قرآنية عمودية (9:16) فاخرة للنشر على Reels / TikTok / Shorts**

معاينة حية متزامنة مع التلاوة كلمة-بكلمة • خلفيات متدرجة وصور وفيديو • موجات صوتية تفاعلية • إشعار جوال • تصدير MP4/WebM من المتصفح مباشرة — بدون أي معالجة على السيرفر.

</div>

---

## 🚀 التشغيل

```bash
npm install
npm run dev        # التطوير على http://localhost:3000
npm run build      # بناء الإنتاج
npm run start      # تشغيل نسخة الإنتاج
npm run typecheck  # فحص الأنواع
```

## 📋 الخطة الكاملة

الخطة الشاملة المنظمة في **[PLAN.md](./PLAN.md)** — العمارة، نموذج الـ Timeline، محرك الرسم، المخاطر، وقائمة QA.

## ✨ ما الذي بُني (V1)

| المعلم | الحالة | المحتوى |
|---|---|---|
| **M0 — الهيكل** | ✅ | TanStack Start + Tailwind v4 + نظام تصميم زجاجي (Glassmorphism/3D) + RTL كامل |
| **M1 — البيانات** | ✅ | 114 سورة مضمّنة محلياً، قراء Quran.com (chapter_reciters) + 10 قراء احتياط من CDN مفتوح، آيات + ترجمة (خطاب/صحيح)، بروكسي صوت بقائمة بيضاء + Range |
| **M2 — المحرك** | ✅ | AudioEngine بساعة AudioContext (صفر انجراف)، Timeline دقيق من segments الرسمية + تقديري بنسبة الحروف، كاراوكي كلمة-بكلمة، StudioShell أبدي (لا اختفاء عند تبديل الخطوات) |
| **M3 — التصميم** | ✅ | 6 تدرجات + صورة (Ken Burns) + فيديو مرفوع + تعتيم، نمط إشعار جوال، 3 خطوط مصحف، ترجمة، 4 أنيميشنات ظهور (كاراوكي/تلاشي/تكبير/نبضة 3D)، Visualizer (أعمدة/موجة، أسفل/خلف) |
| **M4 — التصدير** | ✅ | MediaRecorder بـ codec تكيفي (MP4 على Safari/iOS، WebM على البقية)، دمج الصوت عبر AudioContext، شريط تقدم، تنزيل + مشاركة (Web Share) |
| **M5 — الصقل** | 🟡 | QA على أجهزة حقيقية متبقٍ (انظر PLAN.md §15) |

**إضافات**: نموذج تجريبي مضمّن يعمل بدون إنترنت (سورة الإخلاص، بدون صوت)، سلسلة صوت احتياطية ثلاثية (مباشر → بروكسي → طبعة CDN مكافئة)، واجهة عربية/إنجليزية.

## 🏗️ البنية

```
src/
├── routes/               # الصفحة + 4 مسارات API (بروكسي Quran.com)
├── components/studio/    # StudioShell (المضيف الأبدي) + الخطوات + الملتقطات
├── components/ui/        # Glass / عناصر تحكم / نوافذ / أيقونات
├── lib/canvas/           # renderFrame (محرك الرسم) + layout + animation + design
├── lib/audio/            # AudioEngine (ساعة التطبيق)
├── lib/recorder/         # VideoRecorder (codec تكيفي)
├── lib/quran/            # بيانات + API + بناء Timeline
├── store/                # Zustand (setup/design/engine/export)
└── i18n/                 # عربي/إنجليزي
```

## ⚙️ التقنيات

TanStack Start (Vite 8) • React 19 • Tailwind CSS v4 • Zustand • TanStack Query • Canvas 2D (1080×1920) • Web Audio API • MediaRecorder • Quran.com Content API v4 • Google Fonts (Amiri Quran, Scheherazade New, Noto Naskh)

---

<div align="center"><sub>صُنع بعناية 🤍 لخدمة المحتوى القرآني</sub></div>
