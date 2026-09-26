# SINDAR — Islamic Shorts Creator
## الخطة الشاملة المنظمة والمحسّنة — الإصدار V1

> تطبيق ويب عمودي (موبايل أولاً) لإنشاء مقاطع قرآنية قصيرة بجودة Reels / TikTok / Shorts،
> بمعاينة حية متزامنة مع التلاوة، وتصدير فيديو كامل (صوت + صورة) من المتصفح مباشرة — بدون سيرفر معالجة.

---

## 0) الملخص التنفيذي

| البند | القيمة |
|---|---|
| **المنتج** | منشئ فيديوهات قرآنية عمودية 9:16 (1080×1920) بمظهر فاخر |
| **المستخدم** | صانع محتوى إسلامي على Reels / TikTok / Shorts |
| **التدفق** | 3 خطوات: **Setup → Design → Export** في صفحة واحدة بدون إعادة تحميل |
| **العمارة** | TanStack Start (SSR خفيف) + Canvas Engine على العميل + Zustand |
| **المعالجة** | 100% على العميل: `Canvas` + `Web Audio API` + `MediaRecorder` |
| **اللغات** | عربي أولاً (RTL كامل) + إنجليزية |

**معايير نجاح V1 (قابلة للقياس):**
1. من اختيار السورة إلى فيديو جاهز في **أقل من دقيقتين** (لمقطع 30 ثانية).
2. تزامن الكلمة المضيئة مع الصوت **بانحراف ≤ 80ms** (باستخدام segments الرسمية).
3. تصدير يعمل على: Chrome/Edge Android+Desktop، Safari iOS 15+.
4. معدل إطارات أثناء التسجيل **≥ 24fps** على جهاز أندرويد متوسط.
5. صفر فقدان للحالة (الفيديو الخلفي/الترجمة/الصوت) عند التنقل بين الخطوات.

---

## 1) حسم التناقضات — قرارات هذه النسخة

كانت الخطة الأصلية تحتوي نسختين متعارضتين جزئياً. هذه القرارات النهائية:

| # | التعارض | القرار النهائي | السبب |
|---|---|---|---|
| 1 | WebM فقط أم MP4؟ | **اختيار تكيفي للـ codec**: نجرّب `video/mp4 (H.264+AAC)` أولاً ثم `webm;vp9` ثم `webm;vp8`. مستخدمو iPhone يحصلون على **MP4 حقيقي**، والبقية WebM | Safari ≤18.3 لا يدعم WebM أصلاً ويدعم MP4؛ Chrome لا يدعم MP4 عبر MediaRecorder ويدعم WebM. لا حاجة لـ ffmpeg |
| 2 | صوت آية-بآية أم ملف سورة كامل؟ | **ملف السورة الكامل** من `chapter_recitations` مع `segments=true` (توقيت كل كلمة رسمياً) | توقيت دقيق 100% للتزامن، ملف واحد بدل عشرات الملفات، لا فواصل بين الآيات |
| 3 | قوائم قراء مختلطة | فصل واضح: `/resources/recitations` (آية بآية — لا نستخدمه في V1 إلا كاحتياط) و`/resources/chapter_reciters` (السور كاملة — **هذا ما نستخدمه**) | الـ IDs مختلفة تماماً بين القائمتين — فخ شائع |
| 4 | ffmpeg.wasm لتحويل MP4 | **مؤجل لما بعد V1** (~25MB تحميل) | الحل التكيفي (قرار 1) يغطي 95% من الحالات |
| 5 | حفظ الحالة | Zustand + `persist` **لتفضيلات التصميم فقط** (localStorage). الملفات وTimeline في الذاكرة فقط | البlobs لا تُحفظ في localStorage (حجمها كبير) |
| 6 | مشكلة اختفاء العناصر عند تبديل Tabs | **الكانفس وعناصر الوسائط تُركَّب مرة واحدة في `StudioShell` أبدي** خارج مكونات الخطوات؛ الخطوات تقرأ/تكتب الحالة فقط | جذر المشكلة كان Unmounting — الحل معماري لا ترقيعي |

---

## 2) نطاق V1

### ✅ داخل النطاق
- اختيار السورة (114) مع بحث، واسم سورة مخصص يظهر على الفيديو.
- نطاق الآيات (من/إلى) فارغ افتراضياً + تحقق برمجي من `verses_count`.
- القارئ: من قراء Quran.com **أو رفع ملف صوتي (MP3/M4A) أو فيديو يُستخرج صوته**.
- خلفيات: تدرجات إسلامية جاهزة + صورة ثابتة + **فيديو مخصص من الجهاز** (loop).
- **إشعار وهمي** (Notification Overlay) بنمط إشعار جوال يحتوي الآية.
- **Visualizer** موجات صوتية تتفاعل مع التلاوة (AnalyserNode).
- خطوط: عثماني (Amiri Quran) / نسخ (Scheherazade New / Noto Naskh) + ترجمة إنجليزية اختيارية.
- أنيميشن نصوص: **Karaoke** (تظليل الكلمة مع الصوت) + تأثيرات ظهور (Fade / Scale / 3D Pop) + ظلال ناعمة.
- معاينة حية 9:16 بنفس دالة رسم التصدير تماماً.
- تصدير: MP4/WebM تكيفي + شريط تقدم + تنزيل + مشاركة (Web Share API).
- RTL كامل + واجهة عربية/إنجليزية.

### ❌ خارج النطاق (مؤجل)
- تسجيل دخول / حسابات / حفظ سحابي.
- ffmpeg.wasm أو أي تحويل على السيرفر.
- فلاتر متقدمة / موسيقى خلفية / LUTs.
- تفسير أو حديث (قرآن + ترجمة فقط).
- وضع Landscape أو مقاسات غير 9:16.

---

## 3) العمارة والقرارات التقنية

### 3.1 الستاك

| الطبقة | التقنية | ملاحظات |
|---|---|---|
| الإطار | **TanStack Start** (Vite) | File-based routes + Server Routes |
| الواجهة | **React 19 + Tailwind CSS v4** | RTL أولاً |
| المكونات | **shadcn/ui** (Select, Tabs, Slider, Switch, Progress, Button) + مكونات Glass مخصصة | نعيد تلوينها بالثيم الفاخر |
| الحالة | **Zustand** (slices + persist جزئي) | القاعدة: العناصر في الـ DOM، الحالة في الـ Store |
| البيانات | **TanStack Query** + Server Routes | staleTime طويل للقواميس الثابتة |
| الرسم | **Canvas 2D API** (1080×1920) | `ctx.direction = 'rtl'` |
| الصوت | **Web Audio API** (decodeAudioData + AnalyserNode) | صوت الملف الواحد decoder واحد |
| التسجيل | **MediaRecorder + canvas.captureStream** | codec تكيفي (قرار 1) |
| الخطوط | Google Fonts: Amiri Quran, Scheherazade New, Noto Naskh Arabic, Inter, IBM Plex Sans Arabic | تحميل مع `document.fonts.load` قبل أول إطار |

### 3.2 مصادر البيانات المؤكدة (Quran.com Content API v4 — مجاني بدون مفتاح)

| الغرض | الـ Endpoint |
|---|---|
| قائمة السور | `GET /chapters?language=ar` → `name_arabic`, `verses_count` (114) |
| الآيات + الكلمات + الترجمة | `GET /verses/by_chapter/{id}?words=true&translations=131&fields=text_uthmani&per_page=50&page={n}` (131 = Khattab، 20 = Saheeh Intl) |
| قراء السور الكاملة | `GET /resources/chapter_reciters?language=ar` (**هذا الـ ID** هو المستخدم) |
| ملف الصوت + توقيت الكلمات | `GET /chapter_recitations/{chapter_reciter_id}/{surah}?segments=true` → `audio_url` + `timestamps[]` مع `segments: [word_index, start_ms, end_ms]` |
| احتياط (CDN مفتوح) | `https://cdn.islamic.network/quran/audio/128/{edition}/{globalAyahNumber}.mp3` (آية بآية، CORS مفتوح) |

**ملاحظات حرجة:**
- روابط الصوت الرسمية (`download.quranicaudio.com`) **تحتاج Proxy من السيرفر** لتفادي CORS عند `fetch → ArrayBuffer`. الـ Proxy يدعم `Range` للتقديم.
- ليس كل قارئ لديه `segments`. نعرض شارة "تزامن كلمة-بكلمة" للقراء الذين تتوفر لهم، والبقية يستخدمون التوزيع التقديري (§8.3).
- حافة معروفة: ملفات السور تبدأ بالبسملة (عدا سورة التوبة) — التوقيتات الرسمية تبدأ من الآية 1 نفسها، لكن نتحقق عملياً من الإزاحة ونضبطها (§15 QA).

### 3.3 حقائق المتصفحات المؤكدة (تحدد استراتيجية التصدير)

- **Safari 14.1–18.3**: MediaRecorder يكتب **MP4 (H.264+AAC) فقط** — لذلك مستخدم iPhone يحصل على MP4 حقيقي.
- **Safari 18.4+**: أضاف WebM (VP8/VP9/Opus).
- **Chrome/Edge/Firefox**: WebM (VP9/Opus) — ولا يكتبون MP4 عبر MediaRecorder (عدا H.264-in-WebM جزئياً).
- **iOS**: `canvas.captureStream()` مدعوم منذ Safari 15 تقريباً؛ `AudioContext` يحتاج **إيماءة مستخدم** لتفعيله (زر التشغيل يحل هذا).
- دائماً: `MediaRecorder.isTypeSupported()` قبل إنشاء المسجل — لا افتراضات.

---

## 4) نموذج البيانات — التايملاين (قلب التطبيق)

كل مشروع يُترجَم إلى **Timeline واحد** يستهلكه محرك الرسم. هذا هو العقد (Contract) بين كل الطبقات:

```ts
interface Timeline {
  durationMs: number
  audio: AudioBuffer            // مفكوك وجاهز في AudioContext
  audioSource: 'api' | 'upload'
  verses: TimedVerse[]
}

interface TimedVerse {
  key: string                   // "2:255"
  fromMs: number
  toMs: number
  text: string                  // text_uthmani
  translation?: string
  words: TimedWord[]            // char_type_name === 'word' فقط
}

interface TimedWord {
  text: string
  fromMs: number
  toMs: number
  timing: 'exact' | 'estimated' // exact = من segments الرسمية
}
```

**قواعد البناء:**
- من `chapter_recitations` + `segments`: توقيتات `exact`، تُقص على نطاق الآيات المختار (مع padding بصري 300ms قبل/بعد الآية لانتقالات أنعم).
- من رفع ملف: توقيتات `estimated` (§8.3).
- الـ Timeline يُبنى عند الضغط على "تحميل التلاوة" في خطوة Setup، ويُخزن في `useEngineStore` — لا يُعاد بناؤه عند التنقل بين الخطوات أبداً.

---

## 5) تجربة المستخدم — التدفق التفصيلي

### الشكل العام
- صفحة واحدة: **Stepper** علوي (3 خطوات) + **معاينة حية لاصقة** (Sticky 9:16 مصغرة قابلة للتوسيع) + لوحة تحكم تتحرك أفريقياً مع انتقال ناعم.
- الجوال: المعاينة أعلى الشاشة (نسبة من ارتفاع الشاشة) والتحكم أسفلها. سطح المكتب: عمودان (معاينة يسار/تحكم يمين، معكوس في RTL).

### الخطوة 1 — Setup (الإعداد)
1. **اختيار السورة**: Combobox ذكي مع بحث بالاسم العربي/الإنجليزي/الرقم (114).
2. **اسم السورة المخصص**: حقل يُملأ تلقائياً بالاسم الرسمي وقابل للتعديل — هذا ما يُرسم على الفيديو.
3. **نطاق الآيات**: حقلا `من`/`إلى` **فارغان افتراضياً** + تحقق فوري: أرقام فقط، `1 ≤ من ≤ إلى ≤ verses_count`، رسالة خطأ عربية واضحة.
4. **مصدر الصوت**:
   - تاب "قارئ": قائمة قراء السور الكاملة (اسم + شارة "تزامن كلمة-بكلمة" إن توفرت segments) + معاينة صوتية سريعة قبل الاعتماد.
   - تاب "رفع": زر رفع MP3/M4A **أو فيديو** (نستخرج الصوت بـ `decodeAudioData` على الملف مباشرة). عرض المدة وحجم الملف + تحذير إن تجاوز 10 دقائق.
5. زر **"تحميل التلاوة"** → يبني الـ Timeline وينتقل تلقائياً لخطوة Design عند النجاح. مؤشر تحميل مع مراحل (جلب النص → جلب التوقيت → فك الصوت).

### الخطوة 2 — Design (التصميم)
مجموعات تحكم قابلة للطي (Accordions زجاجية):
1. **الخلفية**: 6 تدرجات جاهزة (ذهبي فاخر / أخضر زمردي داكن / ليلي بنفسجي / أزرق سماوي / رملي دافئ / أسود مخملي) + رفع صورة + رفع فيديو (loop, muted) + شدة طبقة تعتيم (Scrim Slider) لضمان وضوح النص.
2. **نمط العرض**: Normal **أو Notification Overlay** (كارت إشعار جوال يحتوي الآية — أسلوب رائج في Reels) مع تخصيص اسم "التطبيق" الوهمي.
3. **النص**: خط المصحف (عثماني/نسخ) + حجم النص (Slider) + لون/ذهبي للمضيء + ظل ناعم (تشغيل/إيقاف).
4. **الترجمة**: تشغيل/إيقاف + اختيار الترجمة (Khattab / Saheeh Intl).
5. **الأنيميشن**: نمط الظهور (Karaoke / Fade / Scale-up / 3D Pop) + سرعة عامة.
6. **الـ Visualizer**: تشغيل/إيقاف + نمط (أعمدة / موجة) + موضعه (أسفل / خلف النص) + لونه.
7. **الهوية**: إظهار اسم السورة ورقم الآية كشارة علوية (تشغيل/إيقاف).

كل تغيير يظهر **فورياً** في المعاينة الحية (نفس دالة الرسم — §7).

### الخطوة 3 — Export (التصدير)
- ملخص المشروع (السورة، النطاق، المدة، الجودة المتوقعة).
- تحذير شفاف: "التسجيل يجري بالزمن الحقيقي — مدته = مدة التلاوة".
- زر **"إنشاء الفيديو"** → Progress Bar بمراحل (تحضير الخطوط → بدء التسجيل → التسجيل % (زمن فعلي) → إنهاء الملف).
- عند الانتهاء: مشغل معاينة للناتج + **زر تنزيل** (بامتداد MP4 أو Webm حسب المتصفح) + **زر مشاركة** (Web Share API مع الملف إن كان مدعوماً) + زر إعادة التسجيل.
- ملاحظة تُعرض بلطف: "الملف جاهز للنشر مباشرة على المنصات".

---

## 6) بنية المشروع

```
src/
├── routes/
│   ├── __root.tsx                    # الـ Shell: خطوط، ثيم، dir=rtl، خلفية
│   ├── index.tsx                     # الصفحة الواحدة: StudioShell + الخطوات الثلاث
│   └── api/quran/
│       ├── surahs.ts                 # GET قائمة السور (كاش دائم)
│       ├── reciters.ts               # GET قراء السور الكاملة (كاش دائم)
│       ├── verses.$surah.ts          # GET الآيات + الترجمة + الكلمات (كاش)
│       └── audio.ts                  # GET ?url= بروكسي صوت (قائمة بيضاء للنطاقات + Range)
│
├── components/
│   ├── studio/
│   │   ├── StudioShell.tsx           # ⭐ المضيف الأبدي: canvas + video + audio — لا يُفكك أبداً
│   │   ├── StepperBar.tsx            # مؤشر الخطوات الثلاث
│   │   ├── PreviewCard.tsx           # المعاينة اللاصقة + أزرار تشغيل/إيقاف/ملء الشاشة
│   │   ├── steps/
│   │   │   ├── SetupStep.tsx
│   │   │   ├── DesignStep.tsx
│   │   │   └── ExportStep.tsx
│   │   └── controls/                 # SurahPicker, ReciterPicker, AudioUpload,
│   │                                 # BackgroundPicker, TextControls, VisualizerControls...
│   ├── canvas/
│   │   ├── CanvasPreview.tsx         # يربط الـ canvas بـ rAF + AudioEngine
│   │   ├── engine/
│   │   │   ├── renderFrame.ts        # ⭐ دالة الرسم النقية (ctx, timeline, tMs, settings, analyser)
│   │   │   ├── layout.ts             # كسر الكلمات إلى أسطر + قياس مسبق (مرة واحدة لكل آية)
│   │   │   ├── animation.ts          # دوال التيسر (easeOutCubic, spring, pop3d)
│   │   │   └── layers/               # background, scrim, badge, quranText, translation,
│   │   │                             # karaokeHighlight, visualizer, notificationCard
│   │   ├── audio/AudioEngine.ts      # decode + Graph + Analyser + ساعة الصوت
│   │   ├── timeline/buildTimeline.ts # segments → Timeline (+ التقديري للملفات المرفوعة)
│   │   └── recorder/VideoRecorder.ts # captureStream + MediaRecorder + codec تكيفي
│   └── ui/                           # GlassCard, FloatingButton, GoldBadge... (shadcn مخصص)
│
├── store/
│   ├── useSetupStore.ts              # السورة/النطاق/القارئ/الملف المرفوع
│   ├── useDesignStore.ts             # كل تفضيلات التصميم (persist إلى localStorage)
│   ├── useEngineStore.ts             # Timeline + حالات المحرك (بدون persist)
│   └── useExportStore.ts             # حالة التصدير/التقدم/الناتج
│
├── lib/
│   ├── quran/                        # api.ts, types.ts, segments.ts (خريطة word_index → كلمة)
│   ├── fonts.ts                      # تحميل الخطوط قبل أول إطار
│   └── cn.ts, format.ts
│
├── i18n/                             # ar.ts, en.ts (قاموس بسيط — لا مكتبة ثقيلة)
└── styles/                           # globals.css + design-tokens.css
```

---

## 7) محرك الرسم على Canvas

### 7.1 المبدأ الأهم: دالة رسم واحدة
```
renderFrame(ctx, timeline, tMs, designSettings, analyserData?)
```
- **المعاينة الحية والتصدير يستخدمان نفس الدالة حرفياً** — ما تراه هو ما تحصل عليه (WYSIWYG حقيقي، صفر مفاجآت).
- الكانفس دائماً 1080×1920 داخلياً؛ المعاينة تصغّره بـ CSS فقط (أداء ممتاز وثبات أبعاد).

### 7.2 ترتيب الطبقات (Painter's order)
1. **الخلفية**: تدرج (رسم مسبق على OffscreenCanvas مرة واحدة) / صورة (مع Ken Burns بطيء 1.00→1.08) / فيديو (`drawImage(videoEl)` كل إطار، `loop + muted + playsInline`).
2. **Scrim**: تدرج تعتيم رأسي بشفافية قابلة للتحكم — يضمن قراءة النص على أي خلفية.
3. **Visualizer** (وضع "خلف النص").
4. **كتلة الآية**: النص العربي + تظليل Karaoke + أنيميشن الظهور + الظل الناعم.
5. **الترجمة** (اختياري) تحت النص مباشرة.
6. **الشارة العلوية**: اسم السورة (المخصص) + رقم الآية الحالي — كبسولة زجاجية ذهبية.
7. **Visualizer** (وضع "أسفل").
8. **Notification Overlay** (إن فُعّل — يستبدل 4-6 بكارت إشعار زجاجي بأسلوب iOS: أيقونة هلال + اسم التطبيق + "الآن" + نص الآية، مع أنيميشن توسّع عند تغير الآية).

### 7.3 نصوص العربية على Canvas — القواعد
- `ctx.direction = 'rtl'`, `ctx.textAlign = 'center'`.
- **الكسر إلى أسطر مسبق**: لكل آية نحسب `measureText` لكل كلمة + المسافة، ونكوّن الأسطر ضمن العرض الآمن (1080 − 2×120px). النتيجة تُخزن (`layout cache`) — لا قياس داخل حلقة الرسم.
- **Karaoke**: نرسم كل الكلمات بلون أساسي، والكلمة النشطة (حيث `fromMs ≤ t < toMs`) بلون ذهبي + `shadowBlur` توهج خفيف + تكبير 4%. التكبير يُرسم بـ `translate` إلى مركز الكلمة ثم `scale` — لا يعيد كسر الأسطر.
- الأنيميشن لكل كلمة يُشتق من `t − word.fromMs` (Fade: alpha، Scale: 0.85→1، 3D Pop: scaleY بمنحنى spring يحاكي الوثوب).
- ظل النص: `shadowColor: rgba(0,0,0,.45), shadowBlur: 24, offsetY: 8` — قابل للتعطيل.
- مناطق آمنة: أعلى 240px (للشارة) وأسفل 320px (للـ Visualizer) لا يدخلهما النص.

### 7.4 الـ Visualizer
- `AnalyserNode` بـ `fftSize = 256`, `smoothingTimeConstant = 0.8`.
- ~48 عموداً بتجميع لوغاريتمي للترددات، ارتفاع أقصى 260px، حواف دائرية `roundRect`.
- نمطان: `bars` (أعمدة متماثلة من المنتصف) و`wave` (منحنى ناعم تحت النص).
- **قاعدة الأداء**: `Float32Array` واحد يُعاد استخدامه — صفر تخصيص ذاكرة داخل حلقة الرسم.

### 7.5 حلقة الرسم
```
rAF loop (دائمة طالما الاستوديو مفتوح):
  t = audioEngine.currentTimeMs()     # الساعة الرئيسية = صوت AudioContext (صفر انجراف)
  renderFrame(...)
```
- تعمل دائماً في المعاينة (حتى موقوفة — لعرض آخر إطار + الاستجابة لتغييرات التصميم).
- أثناء التصدير **نفس الحلقة** تستمر — المسجل يلتقط الإطارات من `captureStream(30)`.

---

## 8) خط الصوت — AudioEngine

### 8.1 الـ Graph
```
AudioBufferSourceNode ──► GainNode ──┬──► AnalyserNode ──► audioCtx.destination (سماعات)
                                     └──► MediaStreamAudioDestinationNode (للتسجيل فقط)
```
- **الساعة الرئيسية** هي `audioCtx.currentTime` — التزامن مثالي بالتصميم (لا setTimeout ولا performance.now للنص).
- مصدر واحد يعاد إنشاؤه لكل تشغيل (BufferSource لا يُعاد استخدامه).

### 8.2 مصادر الصوت الثلاثة
| المصدر | الآلية |
|---|---|
| API (ملف سورة كامل) | `fetch(/api/quran/audio?url=…)` → `arrayBuffer()` → `decodeAudioData` + التوقيتات الرسمية من segments |
| ملف صوتي مرفوع | `File.arrayBuffer()` → `decodeAudioData` (MP3/M4A/AAC مدعومة) |
| فيديو مرفوع (استخراج صوت) | `File.arrayBuffer()` على ملف الفيديو مباشرة → `decodeAudioData` (يعمل مع MP4/AAC في Chrome وSafari) + رسالة خطأ ودودة للصيغ غير المدعومة |

### 8.3 التوقيت التقديري (للملفات المرفوعة — `estimated`)
1. توزيع مدة الصوت على الآيات **بنسبة عدد الحروف** (وليس عدد الكلمات — أدق للعربية).
2. توزيع زمن كل آية على كلماتها بنسبة الحروف كذلك.
3. إضافة 6% فراغ بين الآيات (فرصة انتقال بصري).
> ملاحظة صادقة في الواجهة: "التزامن تقديري مع الصوت المرفوع — للحصول على تزامن كامل بالكلمة اختر قارئاً من القائمة".

### 8.4 قيود
- مدة قصوى للمقطع: **10 دقائق** (حد أمان للذاكرة: PCM بدقة 44.1kHz ستيريو ≈ 100MB عند 10 دقائق).
- `AudioContext` يُنشأ عند أول إيماءة (زر تشغيل) وفق سياسة المتصفحات.

---

## 9) التصدير — VideoRecorder

### 9.1 خط الأنابيب (Pipeline)
```
1. تحميل الخطوط: document.fonts.load لكل خطوط المصحف + الانتظار ready
2. بناء المسار: videoTrack = canvas.captureStream(30).getVideoTracks()[0]
               audioTrack = MediaStreamAudioDestinationNode.stream.getAudioTracks()[0]
               stream = new MediaStream([videoTrack, audioTrack])
3. اختيار codec (تكيفي — أول مدعوم):
   a) 'video/mp4;codecs=avc1.640028,mp4a.40.2'   → iPhone/Safari → ملف .mp4
   b) 'video/webm;codecs=vp9,opus'                → Chrome/Edge/Firefox → .webm
   c) 'video/webm;codecs=vp8,opus'                → احتياط
   d) 'video/webm'                                → الملاذ الأخير
   (كل خطوة عبر MediaRecorder.isTypeSupported — لا افتراضات)
4. recorder.start(1000)  ثم  audioEngine.play(0)   # المسجل أولاً ثم الصوت
5. أثناء التسجيل: نفس حلقة rAF ترسم (المعاينة مرئية = التقدم مرئي)
                  progress = currentTime / duration
6. عند نهاية الصوت: recorder.stop() → Blob → objectURL → معاينة + تنزيل + مشاركة
```

### 9.2 قواعد أساسية
- **bitrate**: `videoBitsPerSecond: 8_000_000` (1080×1920@30 — جودة نشر ممتازة) + `audioBitsPerSecond: 128_000`.
- التسجيل بالزمن الحقيقي (طبيعة captureStream) — يُشرح للمستخدم مسبقاً بلطف.
- أثناء التسجيل: تعطيل أزرار التنقل بين الخطوات + مؤشر "جارٍ التسجيل" واضح.
- التنظيف: `URL.revokeObjectURL` عند استبدال الناتج أو مغادرة الصفحة.
- مشاركة: `navigator.canShare({ files: [file] })` → زر مشاركة، وإلا يظهر زر التنزيل فقط.

---

## 10) إدارة الحالة — Zustand (والحل الجذري لمشكلة الاختفاء)

### 10.1 القاعدة المعمارية
> **العناصر (canvas/video/audio) تُركَّب مرة واحدة في `StudioShell` وتبقى حية. مكونات الخطوات لا تحتوي أي وسائط — تقرأ وتكتب الحالة فقط.**

- `index.tsx` يركّب `StudioShell` (المضيف) + `StepperBar` + مكون الخطوة الحالية.
- الانتقال بين الخطوات = تبديل مكون تحكم خفيف فقط — الكانفس لم يُفكك أصلاً فلا شيء يختفي.
- الـ Store يحفظ **مراجع** العناصر (`canvasEl`, `videoEl`, `audioEngine`) وليس بياناتها.

### 10.2 الـ Slices
```ts
useSetupStore:  surahId, customSurahName, fromAyah, toAyah (فارغة افتراضياً),
                audioMode: 'reciter' | 'upload', reciterId, uploadedFile
useDesignStore: background{type,value,scrim}, displayMode: 'normal'|'notification',
                font, fontSize, showTranslation, translationId, shadow,
                reveal: 'karaoke'|'fade'|'scale'|'pop3d', visualizer{...},
                showBadge                                  // ← persist إلى localStorage
useEngineStore: timeline, engineStatus, audioEngine(ref), canvasEl(ref), videoEl(ref)
useExportStore: status: 'idle'|'recording'|'finalizing'|'done'|'error',
                progress(0..1), mimeType, blobUrl, fileName
```

---

## 11) نظام التصميم — الواجهة الفاخرة (Premium UI)

### 11.1 لوحة الألوان (Design Tokens)
```css
--bg-base:      #070B14;              /* ليل عميق */
--bg-glow:      radial emerald #0E2A22;
--gold:         #D9B45B;  --gold-soft: #E8C97A;
--emerald:      #10B981;  --emerald-deep: #064E3B;
--surface:      rgba(255,255,255,.06);
--surface-hover: rgba(255,255,255,.10);
--border-glass: rgba(255,255,255,.12);
--text:         #F5F3EE;  --text-muted: #9CA3AF;
```
تدرجات الفيديو الجاهزة (6): ذهبي فاخر / زمردي داكن / ليلي بنفسجي / أزرق سماوي / رملي دافئ / أسود مخملي.

### 11.2 مكون GlassCard (القلب البصري — 3D Floating)
```css
background: linear-gradient(145deg, rgba(255,255,255,.09), rgba(255,255,255,.03));
backdrop-filter: blur(20px) saturate(140%);
border: 1px solid var(--border-glass);
box-shadow: inset 0 1px 0 rgba(255,255,255,.15),   /* حافة ضوء علوية = إحساس 3D */
            0 8px 32px rgba(0,0,0,.35),
            0 2px 8px  rgba(0,0,0,.25);
```
**الحالات والانتقالات** (استجابة كاملة — hover/active/focus):
- `hover`: `translateY(-4px) scale(1.01)` + سطوع السطح + عمق الظل يزيد — إحساس طفو.
- `active`: `translateY(0) scale(.98)` — إحساس ضغط فيزيائي.
- `focus-visible`: حلقة ذهبية `outline: 2px solid var(--gold); offset 2px`.
- `transition: all .3s cubic-bezier(.22,1,.36,1)`.
- ظهور/إخفاء: keyframe `rise-in` (opacity 0→1، translateY(16px)→0، scale(.96)→1، 400ms) — والمكوّنات تُركّب بنمط staggered (تأخير 60ms لكل عنصر).

### 11.3 الطباعة والاتجاه
- نص المصحف: Amiri Quran (عثماني) / Scheherazade New (نسخ) — **داخل الكانفس فقط**.
- الواجهة: IBM Plex Sans Arabic (عربي) + Inter (لاتيني).
- `<html dir="rtl" lang="ar">` منذ الجذر؛ كل الأرقام الواردة في النصوص الدينية تُعرض بأرقام عربية-هندية (١٢٣) داخل الفيديو.
- تبديل اللغة ar/en من قاموس `i18n/` بسيط (بدون مكتبات i18n ثقيلة).

### 11.4 الاستجابة
- Mobile-first: عمود واحد + معاينة لاصقة أعلى (ارتفاع ≈ 34vh).
- `≥ lg`: عمودان (معاينة ثابتة + لوحة تحكم قابلة للتمرير).
- لمس: كل الأهداف ≥ 44×44px، Sliders بأزرار تكبير للمس.

---

## 12) المسارات الخلفية (Server Routes)

| المسار | الوظيفة | الكاش |
|---|---|---|
| `GET /api/quran/surahs` | قائمة 114 سورة (عربي + verses_count) | في الذاكرة + `Cache-Control: public, max-age=86400` |
| `GET /api/quran/reciters` | قراء السور الكاملة + توفر segments | مثلها |
| `GET /api/quran/verses/$surah?from&to&translation` | الآيات + الكلمات + الترجمة (معالجة pagination داخلياً) | `max-age=3600` |
| `GET /api/quran/audio?url=…` | **بروكسي صوت**: قائمة بيضاء صارمة للنطاقات (`download.quranicaudio.com`, `verses.quran.com`, `cdn.islamic.network`) + تمرير `Range` + `Content-Type: audio/mpeg` | 304 للطلبات المتطابقة |

**أمان**: لا يوجد بروكسي مفتوح — القائمة البيضاء إلزامية. لا مفاتيح API (Quran.com مجاني).

---

## 13) خطة التنفيذ — المعالم (Milestones)

> كل معلم له **شرط قبول قابل للاختبار**. لا ننتقل لمعلم قبل استيفاء سابقه.

### M0 — الهيكل والأساس (نصف يوم)
- [ ] Scaffold: TanStack Start + Tailwind v4 + shadcn/ui + Zustand + TanStack Query.
- [ ] `__root.tsx`: RTL، الخطوط، الثيم الداكن، خلفية متدرجة.
- [ ] مكونات UI الزجاجية (GlassCard, FloatingButton, GoldBadge, Stepper).
- **قبول**: الصفحة الرئيسية تعرض Stepper بثلاث خطوات بلا أخطاء، على الجوال وسطح المكتب.

### M1 — طبقة البيانات (1–1.5 يوم)
- [ ] الـ 4 مسارات API + الكاش + القائمة البيضاء.
- [ ] أنواع `lib/quran/types.ts` + دوال الجلب + TanStack Query hooks.
- [ ] SurahPicker (بحث ذكي) + ReciterPicker (مع شارة segments) + تحقق نطاق الآيات.
- [ ] بناء `Timeline` من segments (قص النطاق + padding).
- **قبول**: اختيار "الكهف 1–10 + قارئ لديه segments" يبني Timeline بتوقيتات exact صحيحة.

### M2 — المحرك الأساسي + معاينة حية (2–3 أيام) ⭐ الأهم
- [ ] AudioEngine (decode + graph + ساعة الصوت + unlock بالإيماءة).
- [ ] renderFrame v1: تدرج + scrim + نص عربي RTL بكسر أسطر + شارة السورة.
- [ ] Karaoke (تظليل الكلمة النشطة) + Layout cache.
- [ ] CanvasPreview + StudioShell (الكانفس الأبدي) + ربط Zustand.
- **قبول**: معاينة 9:16 تعرض الكهف 1–10 متزامنة كلمة-بكلمة، والتنقل بين الخطوات لا يكسر شيئاً.

### M3 — طبقات التصميم المتقدمة (1.5–2 يوم)
- [ ] خلفيات: صورة (Ken Burns) + فيديو مرفوع (loop) + Scrim slider.
- [ ] Notification Overlay + تخصيص اسم التطبيق الوهمي.
- [ ] Visualizer (bars/wave) + أنيميشن الظهور (fade/scale/pop3d) + الظلال.
- [ ] الترجمة (Khattab/Saheeh) + خطوط المصحف الثلاثة + رفع الصوت/الفيديو + التوقيت التقديري.
- **قبول**: كل خيارات DesignStep تتفاعل فورياً في المعاينة، ورفع فيديو خلفية يعمل على الجوال.

### M4 — التصدير (1–1.5 يوم)
- [ ] VideoRecorder: codec تكيفي + دمج الصوت + progress + تنزيل + مشاركة.
- [ ] تعطيل التنقل أثناء التسجيل + مؤشر واضح + revocation.
- **قبول**: تصدير "الفاتحة كاملة" ينتج ملفاً بصوت متزامن وبدون انجراف على Chrome Android وSafari iOS.

### M5 — الصقل وضمان الجودة (1–2 يوم)
- [ ] جدول QA الكامل (§15) على الأجهزة الحقيقية.
- [ ] حالات الخطأ الودية (شبكة، صيغة ملف، مدة طويلة، انقطاع).
- [ ] Polish بصري أخير (micro-interactions، فراغات، أيقونات).
- **قبول**: صفر أخطاء حرجة في قائمة QA + Lighthouse Performance ≥ 85 للصفحة الأولى.

> **الإجمالي التقديري: 7–10 أيام عمل** لمنفذ واحد، ويمكن ضغطه بتنفيذ M0+M1 معاً.

---

## 14) المخاطر والتخفيف

| الخطر | الاحتمال | الأثر | التخفيف |
|---|---|---|---|
| CORS على روابط الصوت | مؤكد | عالٍ | البروكسي من اليوم الأول (M1) |
| عدم توفر segments لبعض القراء | مؤكد | متوسط | شارة في الـ UI + التوقيت التقديري + ترتيب القراء المتزامنين أولاً |
| إزاحة البسملة في ملفات السور | متوسط | متوسط | اختبار لكل قارئ مستخدم + إصلاح إزاحة يدوي إن لزم |
| iOS: قيود AudioContext/الذاكرة | متوسط | عالٍ | unlock بإيماءة، حد 10 دقائق، اختبار مبكر على iPhone حقيقي في M2 |
| انخفاض fps على أجهزة ضعيفة أثناء التسجيل | متوسط | متوسط | Layout cache مسبق + صفر تخصيص في rAF + Offscreen canvas للخلفيات الثابتة |
| انجراف تزامن الصوت/الصورة في الملف الناتج | منخفض | عالٍ | الساعة = AudioContext + بدء المسجل قبل الصوت |
| decodeAudioData يفشل على صيغ فيديو غريبة | متوسط | منخفض | رسالة خطأ ودودة + اقتراح MP3/M4A |
| تغيّرات Quran.com API | منخفض | عالٍ | طبقة `lib/quran/api.ts` معزولة + كاش + أنواع صارمة |

---

## 15) قائمة الفحص النهائية (QA)

**حالات القرآن الحرجة:**
- [ ] الفاتحة (7 آيات قصيرة، البسملة = آية 1).
- [ ] التوبة (لا بسملة في الملف الصوتي).
- [ ] السور القصيرة ذات آية واحدة (الكوثر، العصر، الناس...) — من = إلى = 1.
- [ ] آية طويلة جداً (2:255) — كسر أسطر صحيح + توقيتات كلمات كثيرة.
- [ ] أطول نطاق عملي (الكهف 1–10 ≈ 4 دقائق) — أداء وذاكرة.

**المتصفحات:**
- [ ] Chrome Android: تصدير WebM + تشغيل المعاينة + رفع ملفات من الاستوديو.
- [ ] Safari iOS 15+: تصدير **MP4** + Web Share + سلوك الخلفية عند قفل الشاشة أثناء التسجيل.
- [ ] Firefox Desktop: تصدير + Visualizer.
- [ ] درجة حرارة الجهاز واستهلاك البطارية أثناء تسجيل 4 دقائق.

**الواجهة:**
- [ ] RTL كامل بلا نص لاتيني معكوس + تبديل ar/en.
- [ ] التنقل بين الخطوات أثناء التشغيل — لا اختفاء لأي عنصر (اختبار الانحدار الأهم).
- [ ] كل أخطاء الإدخال (نطاق آيات، ملف تالف، شبكة مقطوعة) برسائل عربية واضحة.
- [ ] أرقام الآيات بأرقام عربية-هندية داخل الفيديو.

**الناتج:**
- [ ] الملف يُرفع ويعمل على TikTok/Instagram/YouTube فعلياً.
- [ ] حجم ملف معقول (≈ 30–40MB لكل دقيقة بـ 8Mbps).

---

## 16) ما بعد V1 (Backlog مرتب)

1. **ffmpeg.wasm** كخيار متقدم لتحويل MP4 صريح على المتصفحات غير الداعمة.
2. **Presets/قوالب** جاهزة (3–4 ثيمات كاملة بضغطة واحدة) + حفظها محلياً.
3. **كشف الصمت** لتحسين التوقيت التقديري للملفات المرفوعة.
4. موسيقى خلفية هادئة (مستوى صوت منفصل).
5. علامة مائية/توقيع قناة، وعناوين ثابتة (Text Overlay مخصص).
6. مقاسات أخرى (1:1، 16:9) ونمط "بطاقة اقتباس" ثابتة للتصدير صورة PNG.
7. PWA (تثبيت على الشاشة الرئيسية + عمل offline للتصميم).

---

*الخطة جاهزة للتنفيذ — المرحلة الأولى M0 يمكن البدء بها فوراً.*
