import { matchEditionByName, NETWORK_RECITERS, networkAudioUrl } from './fallbackReciters'
import type { ApiVerse, ChapterAudioInfo, Reciter, VerseTimestamp } from './types'
import { stripHtml } from '../format'

/**
 * طبقة جلب البيانات — استراتيجية مزدوجة:
 * 1) جلب مباشر من متصفح المستخدم (api.quran.com يدعم CORS).
 * 2) عند الفشل: بروكسي عبر مسارات السيرفر (يعمل في الإنتاج حيث الشبكة متاحة).
 * وقائمة السور والنماذج التجريبية مضمّنة محلياً ولا تحتاج شبكة إطلاقاً.
 */

const QURAN_API = 'https://api.quran.com/api/v4'

let lastReciters: Reciter[] = []
export function getLastReciters(): Reciter[] {
  return lastReciters
}
export function resolveReciter(id: string | null): Reciter | undefined {
  return lastReciters.find((r) => r.id === id)
}

async function fetchJsonWithFallback(directUrl: string, proxyUrl: string): Promise<any> {
  try {
    const r = await fetch(directUrl, { headers: { accept: 'application/json' } })
    if (r.ok) return await r.json()
  } catch {
    /* شبكة أو CORS — نجرب البروكسي */
  }
  const r2 = await fetch(proxyUrl, { headers: { accept: 'application/json' } })
  if (!r2.ok) throw new Error(`fetch-failed: ${proxyUrl}`)
  return await r2.json()
}

function mapVerse(v: any): ApiVerse {
  return {
    number: v.verse_number,
    key: v.verse_key,
    textUthmani: v.text_uthmani ?? v.text_imlaei ?? v.text_simple ?? '',
    translation: v.translations?.[0]?.text ? stripHtml(String(v.translations[0].text)) : undefined,
    words: (v.words ?? []).map((w: any) => ({
      position: w.position ?? 0,
      charType: w.char_type_name ?? 'word',
      text: w.text_uthmani ?? w.text_imlaei ?? w.text ?? '',
    })),
  }
}

async function fetchVersesPage(surah: number, page: number, translationId: number): Promise<any> {
  const direct = `${QURAN_API}/verses/by_chapter/${surah}?language=en&words=true&word_fields=text_uthmani&translations=${translationId}&fields=text_uthmani&per_page=50&page=${page}`
  const proxy = `/api/quran/verses?surah=${surah}&page=${page}&translation=${translationId}`
  return fetchJsonWithFallback(direct, proxy)
}

export async function fetchVerses(
  surah: number,
  from: number,
  to: number,
  translationId: number,
): Promise<ApiVerse[]> {
  const totalPages = Math.ceil(to / 50)
  const pages = await Promise.all(
    Array.from({ length: totalPages }, (_, i) => fetchVersesPage(surah, i + 1, translationId)),
  )
  const verses = pages
    .flatMap((p) => p?.verses ?? [])
    .filter((v: any) => v.verse_number >= from && v.verse_number <= to)
    .map(mapVerse) as ApiVerse[]
  verses.sort((a, b) => a.number - b.number)
  if (verses.length !== to - from + 1) throw new Error('verses-incomplete')
  return verses
}

export async function fetchReciters(): Promise<{ reciters: Reciter[]; degraded: boolean }> {
  let qcReciters: Reciter[] = []
  let degraded = false
  try {
    const data = await fetchJsonWithFallback(
      `${QURAN_API}/resources/chapter_reciters?language=ar`,
      '/api/quran/reciters',
    )
    const list: any[] = data?.chapter_reciters ?? data?.reciters ?? []
    qcReciters = list.map((r) => {
      const nameEn: string = r.transliterated_name ?? r.name ?? ''
      return {
        id: `qc-${r.id}`,
        qcId: r.id,
        nameAr: r.name_ar ?? r.reciter_name_ar ?? r.name ?? `قارئ ${r.id}`,
        nameEn,
        source: 'quran' as const,
        sync: 'exact' as const,
        fallbackEdition: matchEditionByName(nameEn),
      }
    })
  } catch {
    degraded = true
  }
  // استبعاد بدائل الشبكة المكافئة لقارئ موجود بالفعل
  const matchedEditions = new Set(qcReciters.map((r) => r.fallbackEdition).filter(Boolean))
  const extras = NETWORK_RECITERS.filter((r) => !matchedEditions.has(r.edition))
  const reciters = [...qcReciters, ...extras]
  lastReciters = reciters
  return { reciters, degraded }
}

export async function fetchChapterAudioInfo(
  qcId: number,
  surah: number,
): Promise<ChapterAudioInfo | null> {
  try {
    const data = await fetchJsonWithFallback(
      `${QURAN_API}/chapter_recitations/${qcId}/${surah}?segments=true`,
      `/api/quran/chapter-audio?reciter=${qcId}&surah=${surah}`,
    )
    const af = data?.audio_file
    if (!af?.audio_url) return null
    let url: string = af.audio_url
    if (url.startsWith('//')) url = `https:${url}`
    const timestamps: VerseTimestamp[] | null = (af.timestamps ?? []).map((t: any) => ({
      verseKey: t.verse_key,
      fromMs: t.timestamp_from ?? 0,
      toMs: t.timestamp_to ?? 0,
      segments: Array.isArray(t.segments) ? t.segments : null,
    }))
    return { audioUrl: url, timestamps }
  } catch {
    return null
  }
}

/** جلب ملف صوتي — مباشر ثم عبر البروكسي */
export async function fetchAudioBuffer(url: string): Promise<ArrayBuffer> {
  try {
    const r = await fetch(url)
    if (r.ok) return await r.arrayBuffer()
  } catch {
    /* CORS أو شبكة — نجرب البروكسي */
  }
  const r2 = await fetch(`/api/quran/audio?url=${encodeURIComponent(url)}`)
  if (!r2.ok) throw new Error('audio-fetch-failed')
  return await r2.arrayBuffer()
}

export { networkAudioUrl }
