import { charCount, clamp } from '../format'
import type { ApiVerse, Segment, Timeline, TimedVerse, TimedWord, VerseTimestamp } from './types'

/**
 * بناء التايملاين — قلب مزامنة النص مع الصوت.
 *
 * مسار "دقيق": من segments الرسمية لـ Quran.com (توقيت كل كلمة بالمللي ثانية).
 * مسار "تقديري": توزيع زمني بنسبة الحروف (للملفات المرفوعة وقراء الشبكة الاحتياطيين)
 * مع حجز زمن للبسملة في بداية ملفات السور الكاملة (عدا الفاتحة والتوبة).
 */

interface BuildInput {
  verses: ApiVerse[]
  surahId: number
  audioBuffer: AudioBuffer | null
  timestamps: VerseTimestamp[] | null
  audioSource: Timeline['audioSource']
  /** للنموذج التجريبي (بدون صوت): مدة افتراضية بالميلي ثانية */
  virtualDurationMs?: number
}

const BISMILLAH_MS = 4200
const LEAD_IN_MS = 400
const TAIL_OUT_MS = 900
const VERSE_GAP_RATIO = 0.05

export function buildTimeline(input: BuildInput): Timeline {
  const { verses, surahId, audioBuffer, timestamps, audioSource } = input
  if (verses.length === 0) throw new Error('timeline-empty')

  const hasAudio = !!audioBuffer
  const totalMs = audioBuffer
    ? audioBuffer.duration * 1000
    : (input.virtualDurationMs ?? estimateDuration(verses))

  let timed: TimedVerse[]
  let exact = false

  if (timestamps && timestamps.length > 0 && hasAudio) {
    timed = buildExact(verses, timestamps)
    exact = timed.every((v) => v.words.length === 0 || v.words[0].timing === 'exact')
  } else {
    timed = buildEstimated(verses, surahId, audioSource, totalMs)
  }

  const first = timed[0]
  const last = timed[timed.length - 1]
  const startMs = clamp(first.fromMs - LEAD_IN_MS, 0, totalMs)
  const endMs = clamp(last.toMs + TAIL_OUT_MS, startMs + 500, totalMs)

  return {
    startMs,
    durationMs: endMs - startMs,
    verses: timed,
    audioSource,
    hasAudio,
    exact,
  }
}

function buildExact(verses: ApiVerse[], timestamps: VerseTimestamp[]): TimedVerse[] {
  const tsByKey = new Map(timestamps.map((t) => [t.verseKey, t]))

  return verses.map((v) => {
    const ts = tsByKey.get(v.key)
    let fromMs: number
    let toMs: number
    if (ts) {
      fromMs = ts.fromMs
      toMs = Math.max(ts.toMs, ts.fromMs + 200)
    } else {
      // آية بلا توقيت — نستوحي زمنها من الجيران أو توزيعاً تقديرياً
      const prev = tsByKey.get(`${v.key.split(':')[0]}:${v.number - 1}`)
      const next = tsByKey.get(`${v.key.split(':')[0]}:${v.number + 1}`)
      const from = prev?.toMs ?? next?.fromMs ?? 0
      const to = next?.fromMs ?? from + estimateVerseMs(v)
      fromMs = from
      toMs = Math.max(to, from + 200)
    }

    const words: TimedWord[] = []
    const wordIdx: number[] = []
    v.words.forEach((w, i) => {
      if (w.charType === 'word' && w.text) {
        words.push({ text: w.text, fromMs, toMs, timing: 'estimated' })
        wordIdx.push(i)
      }
    })

    if (ts?.segments && ts.segments.length > 0) {
      // segments مفهرسة على مصفوفة الكلمات الكاملة — نطبّقها بالفهرس الأصلي
      const segByIdx = new Map<number, Segment>()
      for (const seg of ts.segments) {
        if (Array.isArray(seg) && seg.length >= 3) segByIdx.set(Number(seg[0]), seg)
      }
      let allExact = true
      wordIdx.forEach((fullIdx, k) => {
        const seg = segByIdx.get(fullIdx)
        if (seg) {
          words[k].fromMs = fromMs + Math.max(0, Number(seg[1]))
          words[k].toMs = fromMs + Math.max(Number(seg[1]) + 60, Number(seg[2]))
          words[k].timing = 'exact'
        } else {
          allExact = false
        }
      })
      if (!allExact) distributeWords(words, fromMs, toMs, false)
    } else {
      distributeWords(words, fromMs, toMs, false)
    }

    return { number: v.number, key: v.key, text: v.textUthmani, translation: v.translation, words, fromMs, toMs }
  })
}

function buildEstimated(
  verses: ApiVerse[],
  surahId: number,
  audioSource: Timeline['audioSource'],
  totalMs: number,
): TimedVerse[] {
  const fromAyah = verses[0].number
  const toAyah = verses[verses.length - 1].number

  // ملفات السور الكاملة تبدأ بالبسملة (عدا الفاتحة حيث هي الآية الأولى، والتوبة)
  const bismHead = audioSource === 'api' && surahId !== 1 && surahId !== 9 ? BISMILLAH_MS : 0
  // آيات سابقة غير محمّلة (عند اختيار نطاق لا يبدأ من ١) — نقدّرها بمتوسط طول الآية
  const avgChars = verses.reduce((s, v) => s + Math.max(charCount(v.textUthmani), 1), 0) / verses.length
  const phantomChars = (fromAyah - 1) * avgChars
  const phantomTail = toAyah < verses.length + fromAyah - 1 ? avgChars * 3 : 0 // تقدير بسيط لبقية السورة

  const totalChars =
    verses.reduce((s, v) => s + Math.max(charCount(v.textUthmani), 1), 0) + phantomChars + phantomTail
  const msPerChar = totalMs / totalChars

  const gap = verses.length > 1 ? VERSE_GAP_RATIO * totalMs / verses.length : 0

  let cursor = bismHead + phantomChars * msPerChar
  return verses.map((v) => {
    const weight = Math.max(charCount(v.textUthmani), 1)
    const span = weight * msPerChar
    const fromMs = cursor
    const toMs = cursor + Math.max(span - gap, 300)
    const words: TimedWord[] = []
    v.words.forEach((w) => {
      if (w.charType === 'word' && w.text) {
        words.push({ text: w.text, fromMs, toMs, timing: 'estimated' })
      }
    })
    distributeWords(words, fromMs, toMs, true)
    cursor = toMs + gap
    return { number: v.number, key: v.key, text: v.textUthmani, translation: v.translation, words, fromMs, toMs }
  })
}

/** توزيع زمن الآية على كلماتها بنسبة الحروف */
function distributeWords(words: TimedWord[], fromMs: number, toMs: number, markEstimated: boolean) {
  if (words.length === 0) return
  const total = words.reduce((s, w) => s + Math.max(charCount(w.text), 1), 0)
  let cursor = fromMs
  const span = toMs - fromMs
  words.forEach((w) => {
    const share = (Math.max(charCount(w.text), 1) / total) * span
    w.fromMs = cursor
    w.toMs = cursor + share
    if (markEstimated) w.timing = 'estimated'
    cursor += share
  })
}

function estimateVerseMs(v: ApiVerse): number {
  return Math.max(charCount(v.textUthmani), 1) * 340
}

function estimateDuration(verses: ApiVerse[]): number {
  const chars = verses.reduce((s, v) => s + Math.max(charCount(v.textUthmani), 1), 0)
  return chars * 340 + verses.length * 500
}
