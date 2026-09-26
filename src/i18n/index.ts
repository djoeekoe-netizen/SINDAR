import { useUIStore } from '../store/useUIStore'

/** قاموس واجهة ثنائي اللغة — عربي أولاً */

type Lang = 'ar' | 'en'

const DICT: Record<string, [string, string]> = {
  'app.title': ['SINDAR — منشئ المقاطع القرآنية', 'SINDAR — Islamic Shorts Creator'],
  'app.subtitle': ['مقاطع قرآنية عمودية جاهزة للنشر', 'Vertical Quranic shorts, ready to publish'],
  'app.lang': ['English', 'العربية'],

  'steps.setup': ['الإعداد', 'Setup'],
  'steps.design': ['التصميم', 'Design'],
  'steps.export': ['التصدير', 'Export'],

  'setup.surah': ['السورة', 'Surah'],
  'setup.surahPick': ['اختر السورة…', 'Choose a surah…'],
  'setup.searchSurah': ['ابحث بالاسم أو الرقم…', 'Search by name or number…'],
  'setup.versesCount': ['{n} آية', '{n} verses'],
  'setup.customName': ['اسم السورة على الفيديو', 'Surah name shown on video'],
  'setup.customNameHint': ['عدّله كما تفضل — سيظهر في الشارة', 'Edit it as you like — shown in the badge'],
  'setup.range': ['نطاق الآيات', 'Verse range'],
  'setup.from': ['من', 'From'],
  'setup.to': ['إلى', 'To'],
  'setup.rangeMax': ['الحد الأقصى: {n}', 'Max: {n}'],
  'setup.rangeEmpty': ['أدخل رقمي البداية والنهاية', 'Enter start and end verse numbers'],
  'setup.rangeOrder': ['رقم البداية يجب أن يكون ≤ رقم النهاية', 'Start must be ≤ end'],
  'setup.rangeInvalid': ['أرقام غير صالحة', 'Invalid numbers'],
  'setup.rangeLimit': ['تجاوز عدد آيات السورة ({n})', 'Exceeds surah length ({n})'],
  'setup.audioSource': ['مصدر الصوت', 'Audio source'],
  'setup.reciterTab': ['قارئ', 'Reciter'],
  'setup.uploadTab': ['رفع ملف', 'Upload'],
  'setup.reciterPick': ['اختر القارئ…', 'Choose a reciter…'],
  'setup.searchReciter': ['ابحث عن قارئ…', 'Search reciters…'],
  'setup.syncExact': ['تزامن بالكلمة', 'Word-level sync'],
  'setup.syncEstimated': ['تزامن تقديري', 'Estimated sync'],
  'setup.fallbackGroup': ['مصادر بديلة — تزامن تقديري', 'Alternative sources — estimated sync'],
  'setup.uploadAudio': ['رفع ملف صوتي أو فيديو', 'Upload audio or video file'],
  'setup.uploadAudioHint': [
    'MP3 / M4A / AAC — أو فيديو يُستخرج صوته تلقائياً',
    'MP3 / M4A / AAC — or a video file (audio is extracted)',
  ],
  'setup.uploadNote': [
    'التزامن مع الملفات المرفوعة تقديري — للحصول على تزامن دقيق بالكلمة اختر قارئاً من القائمة',
    'Sync with uploads is estimated — pick a listed reciter for word-level sync',
  ],
  'setup.file': ['الملف المحدد', 'Selected file'],
  'setup.clearFile': ['إزالة', 'Remove'],
  'setup.build': ['تحميل التلاوة وبناء المعاينة', 'Load recitation & build preview'],
  'setup.sample': ['تجربة سريعة بدون صوت — سورة الإخلاص', 'Quick demo without audio — Al-Ikhlas'],
  'setup.translation': ['الترجمة الإنجليزية', 'English translation'],
  'setup.transKhattab': ['د. مصطفى خطاب', 'Dr. Mustafa Khattab'],
  'setup.transSaheeh': ['صحيح إنترناشونال', 'Saheeh International'],
  'setup.degraded': ['تعذر الوصول لقائمة Quran.com — تُعرض مصادر بديلة', 'Quran.com list unavailable — showing alternatives'],

  'stage.verses': ['جلب نص الآيات والترجمة…', 'Fetching verses & translation…'],
  'stage.audioInfo': ['جلب التوقيتات الرسمية…', 'Fetching official word timings…'],
  'stage.audio': ['تحميل وفك ترميز الصوت…', 'Downloading & decoding audio…'],
  'stage.build': ['بناء المزامنة…', 'Building timeline…'],

  'errors.surah': ['اختر السورة أولاً', 'Choose a surah first'],
  'errors.range': ['صحّح نطاق الآيات أولاً', 'Fix the verse range first'],
  'errors.reciter': ['اختر قارئاً', 'Choose a reciter'],
  'errors.file': ['اختر ملفاً صوتياً أو فيديو', 'Choose an audio or video file'],
  'errors.verses': ['تعذر جلب الآيات — تحقق من الاتصال أو جرّب النموذج التجريبي', 'Could not fetch verses — check connection or try the demo'],
  'errors.audio': ['تعذر تحميل الصوت — جرّب قارئاً آخر أو ارفع ملفاً', 'Audio failed — try another reciter or upload a file'],
  'errors.decode': ['تعذر فك ترميز الملف — جرّب MP3 أو M4A', 'Could not decode file — try MP3 or M4A'],
  'errors.recorder': ['متصفحك لا يدعم التسجيل — جرّب Chrome أو Safari حديثاً', 'Recording unsupported — try a modern Chrome or Safari'],
  'errors.record': ['حدث خطأ أثناء التسجيل — أعد المحاولة', 'Recording failed — please retry'],

  'preview.live': ['معاينة حية', 'Live preview'],
  'preview.play': ['تشغيل', 'Play'],
  'preview.pause': ['إيقاف', 'Pause'],
  'preview.expand': ['تكبير', 'Expand'],
  'preview.collapse': ['تصغير', 'Collapse'],
  'preview.recording': ['جارٍ التسجيل', 'REC'],

  'design.bg': ['الخلفية', 'Background'],
  'design.bgGradient': ['تدرجات جاهزة', 'Presets'],
  'design.bgImage': ['صورة ثابتة', 'Still image'],
  'design.bgVideo': ['فيديو متحرك', 'Video loop'],
  'design.uploadImage': ['اختر صورة', 'Choose image'],
  'design.uploadVideo': ['اختر فيديو', 'Choose video'],
  'design.changeMedia': ['تغيير', 'Change'],
  'design.scrim': ['طبقة التعتيم', 'Darkening'],
  'design.displayMode': ['نمط العرض', 'Display style'],
  'design.modeNormal': ['نص مركزي', 'Centered text'],
  'design.modeNotification': ['إشعار جوال', 'Phone notification'],
  'design.notifApp': ['اسم التطبيق في الإشعار', 'App name in the notification'],
  'design.text': ['النص والخط', 'Text & font'],
  'design.font': ['خط المصحف', 'Quran font'],
  'design.fontSize': ['حجم النص', 'Font size'],
  'design.shadow': ['ظل ناعم للنص', 'Soft text shadow'],
  'design.highlight': ['لون التظليل', 'Highlight color'],
  'design.translation': ['الترجمة', 'Translation'],
  'design.animation': ['أنيميشن النص', 'Text animation'],
  'design.karaoke': ['كاراوكي (تظليل مع الصوت)', 'Karaoke (highlight with audio)'],
  'design.fade': ['ظهور تدريجي', 'Fade-in'],
  'design.scale': ['تكبير ناعم', 'Scale-up'],
  'design.pop3d': ['نبضة ثلاثية الأبعاد', '3D pop'],
  'design.visualizer': ['الموجات الصوتية', 'Audio visualizer'],
  'design.visStyle': ['النمط', 'Style'],
  'design.bars': ['أعمدة', 'Bars'],
  'design.wave': ['موجة', 'Wave'],
  'design.visPos': ['الموضع', 'Position'],
  'design.posBottom': ['أسفل', 'Bottom'],
  'design.posBehind': ['خلف النص', 'Behind text'],
  'design.color': ['اللون', 'Color'],
  'design.badge': ['شارة السورة والآية', 'Surah & verse badge'],
  'design.on': ['مفعّل', 'On'],
  'design.off': ['معطّل', 'Off'],

  'export.title': ['إنشاء الفيديو', 'Create the video'],
  'export.summary': ['ملخص المشروع', 'Project summary'],
  'export.surah': ['السورة', 'Surah'],
  'export.range': ['النطاق', 'Range'],
  'export.duration': ['المدة', 'Duration'],
  'export.source': ['الصوت', 'Audio'],
  'export.quality': ['الجودة', 'Quality'],
  'export.resolution': ['الدقة', 'Resolution'],
  'export.fps': ['الإطارات', 'Frame rate'],
  'export.codec': ['الصيغة', 'Codec'],
  'export.start': ['بدء إنشاء الفيديو', 'Start rendering'],
  'export.recording': ['جارٍ التسجيل…', 'Recording…'],
  'export.done': ['الفيديو جاهز 🎉', 'Your video is ready 🎉'],
  'export.download': ['تنزيل', 'Download'],
  'export.share': ['مشاركة', 'Share'],
  'export.rerecord': ['تسجيل من جديد', 'Re-record'],
  'export.note': [
    'التسجيل يجري بالزمن الحقيقي — مدته تساوي مدة التلاوة، ولا تغلق الصفحة أثناءه',
    'Rendering runs in real time — it takes as long as the recitation. Keep the page open',
  ],
  'export.noProject': ['لا يوجد مشروع بعد', 'No project yet'],
  'export.noProjectHint': ['ابدأ من خطوة الإعداد لاختيار السورة والقارئ', 'Start from Setup to pick a surah and reciter'],
  'export.goSetup': ['الذهاب إلى الإعداد', 'Go to Setup'],
  'export.size': ['الحجم', 'Size'],
  'export.hint': ['الملف جاهز للنشر مباشرة على المنصات', 'The file uploads directly to all platforms'],

  'misc.close': ['إغلاق', 'Close'],
  'misc.ayat': ['آية', 'verses'],
  'misc.uploaded': ['ملف مرفوع', 'Uploaded file'],
  'misc.sample': ['نموذج تجريبي', 'Demo'],

  'canvas.surah': ['سورة', 'Surah'],
  'canvas.ayah': ['الآية', 'Ayah'],
  'canvas.hint': ['اختر السورة والآيات من خطوة الإعداد لبدء المعاينة', 'Pick a surah & verses in Setup to start the preview'],
  'canvas.wordmark': ['S I N D A R', 'S I N D A R'],
  'canvas.now': ['الآن', 'now'],
}

export function tr(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key]
  let s = entry ? (lang === 'ar' ? entry[0] : entry[1]) : key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

export function useT() {
  const lang = useUIStore((s) => s.lang)
  return (key: string, vars?: Record<string, string | number>) => tr(lang, key, vars)
}

export function getRenderStrings(lang: Lang) {
  return {
    surah: tr(lang, 'canvas.surah'),
    ayah: tr(lang, 'canvas.ayah'),
    hint: tr(lang, 'canvas.hint'),
    wordmark: tr(lang, 'canvas.wordmark'),
    now: tr(lang, 'canvas.now'),
  }
}
