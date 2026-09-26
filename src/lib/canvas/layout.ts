import { charCount } from '../format'
import type { TimedVerse } from '../quran/types'

/**
 * تخطيط النص العربي على الكانفس — كسر أسطر مسبق مع كاش،
 * حتى لا نكرر measureText داخل حلقة الرسم إطلاقاً.
 */

export interface LaidWord {
  text: string
  fromMs: number
  toMs: number
  /** فهرس الكلمة ضمن الآية (للحفاظ على الترتيب) */
  index: number
  width: number
}

export interface LaidLine {
  words: LaidWord[]
  width: number
}

export interface LaidText {
  lines: LaidLine[]
  /** ارتفاع السطر */
  lineH: number
  /** الحجم النهائي بعد التقليص التلقائي */
  size: number
  totalH: number
  fontCss: string
  /** عرض المسافة بهذا الحجم */
  spaceW: number
}

const cache = new Map<string, LaidText>()

export interface LayoutOpts {
  fontCss: string
  maxSize: number
  minSize?: number
  maxWidth: number
  maxLines: number
  maxHeight?: number
  lineHeightFactor?: number
}

/** يكسر نص الآية إلى أسطر ويقلّص الحجم تلقائياً حتى يستوعب المساحة */
export function layoutVerse(ctx: CanvasRenderingContext2D, verse: TimedVerse, opts: LayoutOpts): LaidText {
  const key = `${verse.key}|${opts.fontCss}|${opts.maxSize}|${opts.maxWidth}|${opts.maxLines}|${opts.maxHeight ?? 0}`
  const hit = cache.get(key)
  if (hit) return hit

  const minSize = opts.minSize ?? 40
  const lhFactor = opts.lineHeightFactor ?? 2.0

  let chosen: LaidText | null = null
  for (let size = opts.maxSize; size >= minSize; size -= 6) {
    ctx.font = `400 ${size}px ${opts.fontCss}`
    const spaceW = ctx.measureText(' ').width || size * 0.26
    const lines = breakLines(ctx, verse.words, spaceW, opts.maxWidth)
    const lineH = size * lhFactor
    const totalH = lines.length * lineH
    if (lines.length <= opts.maxLines && (opts.maxHeight == null || totalH <= opts.maxHeight)) {
      chosen = { lines, lineH, size, totalH, fontCss: opts.fontCss, spaceW }
      break
    }
  }
  if (!chosen) {
    // حتى لو تجاوز — نرسم بأصغر حجم
    const size = minSize
    ctx.font = `400 ${size}px ${opts.fontCss}`
    const spaceW = ctx.measureText(' ').width || size * 0.26
    const lines = breakLines(ctx, verse.words, spaceW, opts.maxWidth)
    chosen = { lines, lineH: size * lhFactor, size, totalH: lines.length * size * lhFactor, fontCss: opts.fontCss, spaceW }
  }

  if (cache.size > 240) cache.clear()
  cache.set(key, chosen)
  return chosen
}

function breakLines(ctx: CanvasRenderingContext2D, words: TimedVerse['words'], spaceW: number, maxWidth: number): LaidLine[] {
  const lines: LaidLine[] = []
  let cur: LaidWord[] = []
  let curW = 0
  words.forEach((w, i) => {
    const width = ctx.measureText(w.text).width
    const add = cur.length === 0 ? width : spaceW + width
    if (curW + add > maxWidth && cur.length > 0) {
      lines.push({ words: cur, width: curW })
      cur = [{ text: w.text, fromMs: w.fromMs, toMs: w.toMs, index: i, width }]
      curW = width
    } else {
      cur.push({ text: w.text, fromMs: w.fromMs, toMs: w.toMs, index: i, width })
      curW += add
    }
  })
  if (cur.length) lines.push({ words: cur, width: curW })
  return lines
}

/** كاش مركز لموضع الكلمات: يحسب مراكز الكلمات في كل سطر (RTL) */
export interface WordPos extends LaidWord {
  cx: number
  cy: number
}

export function wordPositions(laid: LaidText, centerX: number, startY: number): WordPos[][] {
  return laid.lines.map((line, li) => {
    const lineLeft = centerX - line.width / 2
    const cy = startY + li * laid.lineH + laid.lineH / 2
    let fromRight = 0
    return line.words.map((w) => {
      const cx = lineLeft + line.width - fromRight - w.width / 2
      fromRight += w.width + 0 // المسافة تُحتسب عند القياس — نضيفها هنا
      return { ...w, cx, cy }
    })
  })
}

/** كسر نص لاتيني (ترجمة) إلى أسطر — بكاش */
const latinCache = new Map<string, string[]>()

export function layoutLatin(ctx: CanvasRenderingContext2D, text: string, font: string, maxWidth: number, key: string): string[] {
  const ck = `${key}|${font}|${maxWidth}`
  const hit = latinCache.get(ck)
  if (hit) return hit
  ctx.font = font
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (ctx.measureText(t).width > maxWidth && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = t
    }
  }
  if (cur) lines.push(cur)
  if (latinCache.size > 300) latinCache.clear()
  latinCache.set(ck, lines)
  return lines
}

/** تقدير عدد الحروف (مستخدم في مواضع داخلية) */
export { charCount }
