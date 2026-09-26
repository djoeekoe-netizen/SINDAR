import { easeOutBack, easeOutCubic, clamp01 } from './animation'
import { layoutLatin, layoutVerse, wordPositions } from './layout'
import {
  CANVAS_H,
  CANVAS_W,
  QURAN_FONTS,
  getGradient,
  highlightHex,
  type DesignSettings,
  type GradientPreset,
} from './design'
import { toArabicDigits } from '../format'
import type { ProjectMeta, Timeline, TimedVerse } from '../quran/types'

/**
 * محرك الرسم — دالة واحدة تُستخدم للمعاينة الحية وللتصدير معاً (WYSIWYG حقيقي).
 * قواعد الأداء: لا measureText خارج الكاش، لا تخصيص كائنات داخل الحلقة.
 */

export interface RenderStrings {
  surah: string
  ayah: string
  hint: string
  wordmark: string
  now: string
}

export interface RenderArgs {
  ctx: CanvasRenderingContext2D
  timeline: Timeline | null
  tMs: number
  design: DesignSettings
  meta: ProjectMeta | null
  media: { video: HTMLVideoElement | null; image: HTMLImageElement | null }
  analyserData: Uint8Array | null
  strings: RenderStrings
}

export function renderFrame(args: RenderArgs): void {
  const { ctx, timeline, design } = args
  const tAbs = args.tMs

  drawBackground(ctx, design, args.media, tAbs)

  if (!timeline) {
    drawPlaceholder(ctx, args.strings)
    return
  }

  if (design.visualizer.on && design.visualizer.position === 'behind') {
    drawVisualizer(ctx, args.analyserData, design, tAbs, 'behind')
  }

  if (design.displayMode === 'notification') {
    drawNotificationCard(ctx, timeline, tAbs, design, args.strings)
  } else {
    drawVerseBlock(ctx, timeline, tAbs, design, args.meta, args.strings)
  }

  if (design.visualizer.on && design.visualizer.position === 'bottom') {
    drawVisualizer(ctx, args.analyserData, design, tAbs, 'bottom')
  }
}

/* ------------------------------------------------------------------ */
/* الخلفيات                                                            */
/* ------------------------------------------------------------------ */

function drawBackground(
  ctx: CanvasRenderingContext2D,
  design: DesignSettings,
  media: RenderArgs['media'],
  tAbs: number,
): void {
  const bg = design.background
  let drawn = false
  if (bg.type === 'video' && media.video && media.video.readyState >= 2) {
    drawCoverEl(ctx, media.video, 1)
    drawn = true
  } else if (bg.type === 'image' && media.image && media.image.complete && media.image.naturalWidth > 0) {
    const kb = 1 + 0.07 * ((tAbs / 45000) % 1) // Ken Burns بطيء
    drawCoverEl(ctx, media.image, kb)
    drawn = true
  }
  if (!drawn) {
    ctx.drawImage(gradientCanvas(getGradient(bg.gradientId)), 0, 0)
  }
  drawScrim(ctx, bg.scrim)
}

function drawScrim(ctx: CanvasRenderingContext2D, s: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H)
  g.addColorStop(0, `rgba(0,0,0,${(0.5 * s).toFixed(3)})`)
  g.addColorStop(0.45, `rgba(0,0,0,${(0.16 * s).toFixed(3)})`)
  g.addColorStop(1, `rgba(0,0,0,${(0.55 * s).toFixed(3)})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
}

function drawCoverEl(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement | HTMLImageElement,
  scale: number,
): void {
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
  if (!w || !h) return
  const s = Math.max(CANVAS_W / w, CANVAS_H / h) * scale
  const dw = w * s
  const dh = h * s
  ctx.drawImage(el, (CANVAS_W - dw) / 2, (CANVAS_H - dh) / 2, dw, dh)
}

/* ---- كاش التدرجات (Offscreen) ---- */

const gradientCache = new Map<string, HTMLCanvasElement>()

function gradientCanvas(g: GradientPreset): HTMLCanvasElement {
  const hit = gradientCache.get(g.id)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = CANVAS_W
  c.height = CANVAS_H
  const x = c.getContext('2d')!

  const lg = x.createLinearGradient(0, 0, CANVAS_W, CANVAS_H)
  lg.addColorStop(0, g.stops[0])
  lg.addColorStop(0.55, g.stops[1])
  lg.addColorStop(1, g.stops[2])
  x.fillStyle = lg
  x.fillRect(0, 0, CANVAS_W, CANVAS_H)

  // توهج مركزي ناعم
  const rg = x.createRadialGradient(CANVAS_W / 2, 700, 0, CANVAS_W / 2, 700, 980)
  rg.addColorStop(0, hexA(g.glow, 0.22))
  rg.addColorStop(1, hexA(g.glow, 0))
  x.fillStyle = rg
  x.fillRect(0, 0, CANVAS_W, CANVAS_H)

  // نقاط ضوء خافتة (بذرة ثابتة)
  const rand = mulberry32(hashStr(g.id))
  for (let i = 0; i < 64; i++) {
    const px = rand() * CANVAS_W
    const py = rand() * CANVAS_H
    const pr = 1 + rand() * 2.2
    x.globalAlpha = 0.04 + rand() * 0.08
    x.fillStyle = '#FFFFFF'
    x.beginPath()
    x.arc(px, py, pr, 0, Math.PI * 2)
    x.fill()
  }
  x.globalAlpha = 1

  // فينييت
  const vg = x.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.3, CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.30)')
  x.fillStyle = vg
  x.fillRect(0, 0, CANVAS_W, CANVAS_H)

  gradientCache.set(g.id, c)
  return c
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const gg = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${gg},${b},${a})`
}

function hashStr(s: string): number {
  let h = 1779033703
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* الشارة العلوية (اسم السورة + رقم الآية)                              */
/* ------------------------------------------------------------------ */

function drawBadge(
  ctx: CanvasRenderingContext2D,
  meta: ProjectMeta | null,
  verse: TimedVerse,
  enterP: number,
  strings: RenderStrings,
): void {
  if (enterP <= 0.01) return
  const font1 = '600 42px "IBM Plex Sans Arabic", sans-serif'
  const font2 = '400 36px "IBM Plex Sans Arabic", sans-serif'
  const text1 = `${strings.surah} ${meta?.surahName ?? ''}`.trim()
  const text2 = `${strings.ayah} ${toArabicDigits(verse.number)}`

  ctx.save()
  ctx.globalAlpha = enterP
  ctx.font = font1
  const w1 = ctx.measureText(text1).width
  ctx.font = font2
  const w2 = ctx.measureText(text2).width
  const gap = 28
  const padX = 46
  const pillW = w1 + gap + w2 + padX * 2
  const pillH = 88
  const pillX = (CANVAS_W - pillW) / 2
  const pillY = 150

  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  ctx.fillStyle = 'rgba(8,10,18,0.45)'
  roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 2
  roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2)
  ctx.stroke()

  // خط ذهبي رفيع أسفل الشارة
  const underlineW = pillW * 0.5
  const ug = ctx.createLinearGradient((CANVAS_W - underlineW) / 2, 0, (CANVAS_W + underlineW) / 2, 0)
  ug.addColorStop(0, 'rgba(217,180,91,0)')
  ug.addColorStop(0.5, 'rgba(232,201,122,0.9)')
  ug.addColorStop(1, 'rgba(217,180,91,0)')
  ctx.fillStyle = ug
  ctx.fillRect((CANVAS_W - underlineW) / 2, pillY + pillH + 10, underlineW, 2)

  const contentW = w1 + gap + w2
  const x1 = (CANVAS_W - contentW) / 2 + w1 / 2
  const x2 = (CANVAS_W + contentW) / 2 - w2 / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font1
  ctx.fillStyle = '#E8C97A'
  ctx.fillText(text1, x1, pillY + pillH / 2 + 2)
  ctx.font = font2
  ctx.fillStyle = 'rgba(245,243,238,0.82)'
  ctx.fillText(text2, x2, pillY + pillH / 2 + 2)
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* كتلة الآية (النمط العادي)                                            */
/* ------------------------------------------------------------------ */

function currentVerse(timeline: Timeline, tAbs: number): TimedVerse {
  const verses = timeline.verses
  let v = verses[0]
  for (const vv of verses) {
    if (vv.fromMs <= tAbs) v = vv
    else break
  }
  return v
}

interface WordStyle {
  alpha: number
  scale: number
  fill: string
  glow: string | null
}

function wordStyle(
  design: DesignSettings,
  spoken: boolean,
  active: boolean,
  wordP: number,
  baseFill: string,
): WordStyle {
  const hl = highlightHex(design.highlight)
  switch (design.reveal) {
    case 'karaoke':
      if (active) return { alpha: 1, scale: 1.05, fill: hl, glow: hl }
      return { alpha: spoken ? 1 : 0.58, scale: 1, fill: baseFill, glow: null }
    case 'fade':
      return { alpha: 0.08 + 0.92 * easeOutCubic(wordP), scale: 1, fill: baseFill, glow: null }
    case 'scale':
      return { alpha: wordP, scale: 0.82 + 0.18 * easeOutBack(wordP), fill: baseFill, glow: null }
    case 'pop3d':
      return {
        alpha: Math.min(1, wordP * 1.8),
        scale: Math.max(0.01, easeOutBack(wordP)),
        fill: baseFill,
        glow: active ? hl : null,
      }
  }
}

function drawVerseBlock(
  ctx: CanvasRenderingContext2D,
  timeline: Timeline,
  tAbs: number,
  design: DesignSettings,
  meta: ProjectMeta | null,
  strings: RenderStrings,
): void {
  const v = currentVerse(timeline, tAbs)
  const enterP = clamp01((tAbs - v.fromMs) / 420)
  const enterE = easeOutCubic(enterP)

  const fontCss = QURAN_FONTS[design.font].css
  const laid = layoutVerse(ctx, v, {
    fontCss,
    maxSize: design.fontSize,
    maxWidth: 860,
    maxLines: 13,
    maxHeight: 1060,
  })

  const transFont = '400 34px Inter, sans-serif'
  const transLines =
    design.showTranslation && v.translation
      ? layoutLatin(ctx, v.translation, transFont, 820, `${v.key}|trans`)
      : []
  const transH = transLines.length ? 36 + transLines.length * 50 : 0

  const contentH = laid.totalH + transH
  const centerY = 960
  const startY = centerY - contentH / 2 + (1 - enterE) * 20

  if (design.showBadge) drawBadge(ctx, meta, v, enterP, strings)

  if (enterP <= 0.001 && tAbs < v.fromMs) return

  const positions = wordPositions(laid, CANVAS_W / 2, startY)
  const baseFill = '#F7F4EC'

  ctx.save()
  ctx.globalAlpha = enterE
  ctx.direction = 'rtl'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `400 ${laid.size}px ${fontCss}`

  for (const line of positions) {
    for (const w of line) {
      const spoken = tAbs >= w.toMs
      const active = tAbs >= w.fromMs && tAbs < w.toMs
      const wordP = clamp01((tAbs - w.fromMs) / 280)
      const st = wordStyle(design, spoken, active, wordP, baseFill)

      ctx.save()
      ctx.globalAlpha *= st.alpha
      ctx.translate(w.cx, w.cy)
      ctx.scale(st.scale, st.scale)
      if (st.glow) {
        ctx.shadowColor = st.glow
        ctx.shadowBlur = 30
      } else if (design.textShadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)'
        ctx.shadowBlur = 16
        ctx.shadowOffsetY = 6
      }
      ctx.fillStyle = st.fill
      ctx.fillText(w.text, 0, 0)
      ctx.restore()
    }
  }

  // الترجمة
  if (transLines.length) {
    const tp = clamp01((tAbs - v.fromMs - 550) / 450)
    if (tp > 0) {
      ctx.globalAlpha = enterE * tp
      ctx.direction = 'ltr'
      ctx.font = transFont
      ctx.fillStyle = 'rgba(238,240,246,0.88)'
      const ty0 = startY + laid.totalH + 36 + 16
      transLines.forEach((line, i) => {
        ctx.fillText(line, CANVAS_W / 2, ty0 + i * 50)
      })
    }
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* نمط الإشعار الوهمي (Notification Overlay)                            */
/* ------------------------------------------------------------------ */

function drawNotificationCard(
  ctx: CanvasRenderingContext2D,
  timeline: Timeline,
  tAbs: number,
  design: DesignSettings,
  strings: RenderStrings,
): void {
  const v = currentVerse(timeline, tAbs)
  const enterP = clamp01((tAbs - v.fromMs) / 380)
  const pop = easeOutBack(enterP)

  const fontCss = QURAN_FONTS[design.font].css
  const laid = layoutVerse(ctx, v, {
    fontCss,
    maxSize: 54,
    maxWidth: 740,
    maxLines: 12,
    maxHeight: 950,
    lineHeightFactor: 1.9,
  })
  const transFont = '400 30px Inter, sans-serif'
  const transLines =
    design.showTranslation && v.translation
      ? layoutLatin(ctx, v.translation, transFont, 740, `${v.key}|ntrans`)
      : []

  const cardW = 880
  const cardX = (CANVAS_W - cardW) / 2
  const cardY = 170
  const headerH = 118
  const bodyH = laid.totalH + (transLines.length ? 26 + transLines.length * 44 : 0)
  const cardH = headerH + bodyH + 40

  ctx.save()
  // أنيميشن الظهور — من أعلى
  ctx.translate(CANVAS_W / 2, cardY + 60)
  ctx.scale(0.94 + 0.06 * pop, 0.94 + 0.06 * pop)
  ctx.translate(-CANVAS_W / 2, -(cardY + 60))
  ctx.globalAlpha = enterP

  // الظل ثم الكارت
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 64
  ctx.shadowOffsetY = 26
  ctx.fillStyle = 'rgba(15,19,32,0.74)'
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 44)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 2
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 44)
  ctx.stroke()
  // حافة ضوء علوية
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath()
  ctx.moveTo(cardX + 44, cardY + 3)
  ctx.lineTo(cardX + cardW - 44, cardY + 3)
  ctx.stroke()

  // الرأس: أيقونة (يمين RTL) + اسم التطبيق + "الآن" (يسار)
  const iconCx = cardX + cardW - 62
  const iconCy = cardY + headerH / 2
  ctx.fillStyle = 'rgba(232,201,122,0.14)'
  ctx.beginPath()
  ctx.arc(iconCx, iconCy, 38, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(232,201,122,0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(iconCx, iconCy, 38, 0, Math.PI * 2)
  ctx.stroke()
  drawCrescent(ctx, iconCx, iconCy, 17, '#E8C97A')

  ctx.direction = 'rtl'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'right'
  ctx.font = '600 40px "IBM Plex Sans Arabic", sans-serif'
  ctx.fillStyle = '#F5F3EE'
  ctx.fillText(design.notifAppName || 'SINDAR', iconCx - 56, iconCy - 6)
  ctx.font = '400 28px "IBM Plex Sans Arabic", sans-serif'
  ctx.fillStyle = 'rgba(245,243,238,0.5)'
  ctx.textAlign = 'left'
  ctx.fillText(strings.now, cardX + 40, iconCy - 6)

  // نص الآية
  const positions = wordPositions(laid, CANVAS_W / 2, cardY + headerH + 8)
  const baseFill = '#F7F4EC'
  ctx.textAlign = 'center'
  ctx.font = `400 ${laid.size}px ${fontCss}`

  for (const line of positions) {
    for (const w of line) {
      const spoken = tAbs >= w.toMs
      const active = tAbs >= w.fromMs && tAbs < w.toMs
      const wordP = clamp01((tAbs - w.fromMs) / 280)
      const st = wordStyle(design, spoken, active, wordP, baseFill)
      ctx.save()
      ctx.globalAlpha *= st.alpha
      ctx.translate(w.cx, w.cy)
      ctx.scale(st.scale, st.scale)
      if (st.glow) {
        ctx.shadowColor = st.glow
        ctx.shadowBlur = 24
      } else if (design.textShadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = 12
        ctx.shadowOffsetY = 4
      }
      ctx.fillStyle = st.fill
      ctx.fillText(w.text, 0, 0)
      ctx.restore()
    }
  }

  if (transLines.length) {
    const tp = clamp01((tAbs - v.fromMs - 500) / 400)
    if (tp > 0) {
      ctx.globalAlpha = tp
      ctx.direction = 'ltr'
      ctx.font = transFont
      ctx.fillStyle = 'rgba(230,233,240,0.78)'
      const ty0 = cardY + headerH + 8 + laid.totalH + 26 + 14
      transLines.forEach((line, i) => ctx.fillText(line, CANVAS_W / 2, ty0 + i * 44))
    }
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* الموجات الصوتية (Visualizer)                                        */
/* ------------------------------------------------------------------ */

function avgEnergy(data: Uint8Array | null): number {
  if (!data || data.length === 0) return 0
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  return sum / data.length / 255
}

function drawVisualizer(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array | null,
  design: DesignSettings,
  tAbs: number,
  position: 'bottom' | 'behind',
): void {
  const color = highlightHex(design.visualizer.color)

  if (position === 'behind') {
    const energy = avgEnergy(data)
    ctx.save()
    ctx.globalAlpha = 0.13
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    for (let k = 0; k < 3; k++) {
      ctx.lineWidth = 30 - k * 8
      ctx.beginPath()
      const baseY = 960 + (k - 1) * 110
      for (let x = 0; x <= CANVAS_W; x += 24) {
        const ph = (x / CANVAS_W) * Math.PI * 2
        const amp = (26 + energy * 210) * (1 - Math.abs(k - 1) * 0.3)
        const y = baseY + Math.sin(ph * 1.5 + tAbs / 850 + k * 1.7) * amp
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  // الوضع السفلي
  if (design.visualizer.style === 'bars') {
    const N = 42
    const barW = 14
    const usable = CANVAS_W - 200
    const gap = (usable - N * barW) / (N - 1)
    const baseY = 1812
    const maxH = 235
    ctx.save()
    ctx.fillStyle = color
    for (let i = 0; i < N; i++) {
      let v: number
      if (data && data.length > 0) {
        const dist = Math.abs(i - (N - 1) / 2) / ((N - 1) / 2)
        const idx = Math.min(data.length - 1, Math.floor((1 - dist) * data.length * 0.6))
        v = data[idx] / 255
      } else {
        v = 0.028 + 0.022 * Math.sin(tAbs / 420 + i * 0.55)
      }
      const h = 7 + v * maxH
      const x = 100 + i * (barW + gap)
      ctx.globalAlpha = 0.55 + v * 0.45
      roundRectPath(ctx, x, baseY - h, barW, h, 7)
      ctx.fill()
    }
    ctx.restore()
  } else {
    // موجة ناعمة أسفل
    const energy = avgEnergy(data)
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.shadowColor = color
    ctx.shadowBlur = 18
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    const baseY = 1780
    const pts = 56
    for (let i = 0; i <= pts; i++) {
      const x = 100 + (i / pts) * (CANVAS_W - 200)
      let amp: number
      if (data && data.length > 0) {
        const idx = Math.min(data.length - 1, Math.floor((i / pts) * data.length * 0.7))
        amp = (data[idx] / 255) * 190
      } else {
        amp = 14 + 10 * Math.sin(tAbs / 500 + i * 0.5)
      }
      const y = baseY - amp * (0.35 + energy * 0.65) - 14 * Math.sin(tAbs / 700 + i * 0.35)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
  }
}

/* ------------------------------------------------------------------ */
/* إطار البداية (لا يوجد مشروع بعد)                                     */
/* ------------------------------------------------------------------ */

function drawPlaceholder(ctx: CanvasRenderingContext2D, strings: RenderStrings): void {
  ctx.save()
  drawCrescent(ctx, CANVAS_W / 2, 790, 130, '#E8C97A')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.direction = 'ltr'
  ctx.font = '600 64px Inter, sans-serif'
  ctx.fillStyle = '#E8C97A'
  ctx.shadowColor = 'rgba(232,201,122,0.35)'
  ctx.shadowBlur = 30
  ctx.fillText(strings.wordmark, CANVAS_W / 2, 1000)
  ctx.shadowColor = 'transparent'

  ctx.direction = 'rtl'
  ctx.font = '400 40px "IBM Plex Sans Arabic", sans-serif'
  ctx.fillStyle = 'rgba(245,243,238,0.82)'
  const lines = layoutLatin(ctx, strings.hint, '400 40px "IBM Plex Sans Arabic", sans-serif', 720, 'hint|40')
  lines.forEach((line, i) => {
    ctx.fillText(line, CANVAS_W / 2, 1110 + i * 64)
  })

  ctx.font = '400 28px Inter, sans-serif'
  ctx.fillStyle = 'rgba(245,243,238,0.4)'
  ctx.direction = 'ltr'
  ctx.fillText('9:16 · 1080 × 1920', CANVAS_W / 2, 1820)
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* أدوات مشتركة                                                        */
/* ------------------------------------------------------------------ */

const crescentCache = new Map<string, HTMLCanvasElement>()

function drawCrescent(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const key = `${color}|${Math.round(r)}`
  let c = crescentCache.get(key)
  if (!c) {
    const size = Math.ceil(r * 2.6)
    c = document.createElement('canvas')
    c.width = size
    c.height = size
    const x = c.getContext('2d')!
    const half = size / 2
    x.fillStyle = color
    x.beginPath()
    x.arc(half, half, r, 0, Math.PI * 2)
    x.fill()
    x.globalCompositeOperation = 'destination-out'
    x.beginPath()
    x.arc(half + r * 0.42, half - r * 0.1, r * 0.84, 0, Math.PI * 2)
    x.fill()
    crescentCache.set(key, c)
  }
  ctx.drawImage(c, cx - c.width / 2, cy - c.height / 2)
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  if (typeof (ctx as any).roundRect === 'function') {
    ;(ctx as any).roundRect(x, y, w, h, r)
    return
  }
  const rr = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
