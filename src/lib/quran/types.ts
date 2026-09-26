/** أنواع بيانات القرآن والتايملاين — العقد المشترك بين كل الطبقات */

export interface Chapter {
  id: number
  nameAr: string
  nameEn: string
  versesCount: number
}

export type ReciterSource = 'quran' | 'network'

export interface Reciter {
  /** معرف موحّد داخلي */
  id: string
  nameAr: string
  nameEn?: string
  source: ReciterSource
  /** معرف قراء السور الكاملة في Quran.com (chapter_reciters) */
  qcId?: number
  /** معرف طبعة cdn.islamic.network (احتياط) */
  edition?: string
  /** طبعة مكافئة على islamic.network تُستخدم إن فشل مصدر Quran.com */
  fallbackEdition?: string
  /** تزامن دقيق بالكلمة (segments) متوقع لهذا القارئ */
  sync: 'exact' | 'estimated'
}

export interface ApiWord {
  position: number
  charType: string
  text: string
}

export interface ApiVerse {
  number: number
  key: string
  textUthmani: string
  translation?: string
  words: ApiWord[]
}

/** [word_index, start_ms, end_ms] كما ترد من Quran.com */
export type Segment = [number, number, number]

export interface VerseTimestamp {
  verseKey: string
  fromMs: number
  toMs: number
  segments: Segment[] | null
}

export interface ChapterAudioInfo {
  audioUrl: string
  timestamps: VerseTimestamp[] | null
}

export interface TimedWord {
  text: string
  fromMs: number
  toMs: number
  timing: 'exact' | 'estimated'
}

export interface TimedVerse {
  number: number
  key: string
  text: string
  translation?: string
  words: TimedWord[]
  fromMs: number
  toMs: number
}

export type AudioSourceKind = 'api' | 'upload' | 'sample'

export interface Timeline {
  /** بداية التشغيل داخل الملف الصوتي (ms) */
  startMs: number
  /** مدة المقطع (ms) */
  durationMs: number
  /** الآيات مرتبة زمنياً بأزمنة مطلقة داخل الملف الصوتي */
  verses: TimedVerse[]
  audioSource: AudioSourceKind
  hasAudio: boolean
  /** هل التوقيتات رسمية (segments) أم تقديرية */
  exact: boolean
}

export interface ProjectMeta {
  surahId: number
  surahName: string
  fromAyah: number
  toAyah: number
  reciterName: string
  translationName: string
}
