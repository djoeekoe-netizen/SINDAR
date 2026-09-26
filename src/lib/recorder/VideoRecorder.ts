import type { AudioEngine } from '../audio/AudioEngine'
import type { Timeline } from '../quran/types'

/**
 * التصدير — تسجيل الكانفس + الصوت عبر MediaRecorder.
 * اختيار الـ codec تكيفي: MP4 (H.264+AAC) على Safari/iOS أولاً،
 * ثم WebM (VP9/VP8+Opus) لبقية المتصفحات.
 */

export interface RecorderMime {
  mimeType: string
  ext: 'mp4' | 'webm'
  label: string
}

const CANDIDATES: RecorderMime[] = [
  { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4', label: 'MP4 · H.264' },
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', label: 'MP4 · H.264' },
  { mimeType: 'video/mp4', ext: 'mp4', label: 'MP4' },
  { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM · VP9' },
  { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM · VP8' },
  { mimeType: 'video/webm', ext: 'webm', label: 'WebM' },
]

export function pickMime(): RecorderMime | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const c of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mimeType)) return c
    } catch {
      /* تابع للمرشح التالي */
    }
  }
  return null
}

export interface RecordResult {
  blob: Blob
  mimeType: string
  ext: 'mp4' | 'webm'
}

export interface RecordOptions {
  canvas: HTMLCanvasElement
  engine: AudioEngine
  timeline: Timeline
  mime: RecorderMime
  fps?: number
  onProgress?: (p: number) => void
}

export async function recordCanvas(opts: RecordOptions): Promise<RecordResult> {
  const { canvas, engine, timeline, mime } = opts
  const fps = opts.fps ?? 30

  const stream = canvas.captureStream(fps)
  const audioTrack = engine.getRecordTrack()
  if (audioTrack) stream.addTrack(audioTrack)

  const recorder = new MediaRecorder(stream, {
    mimeType: mime.mimeType,
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 128_000,
  })

  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start(1000)

  const tick = window.setInterval(() => {
    const p = (engine.currentTimeMs() - timeline.startMs) / Math.max(timeline.durationMs, 1)
    opts.onProgress?.(Math.min(1, Math.max(0, p)))
  }, 250)

  try {
    await new Promise<void>((resolve) => {
      engine.onEnded = () => resolve()
      void engine.play(timeline.startMs)
    })
  } finally {
    window.clearInterval(tick)
    engine.onEnded = null
  }

  // مهلة قصيرة لالتقاط آخر الإطارات قبل الإيقاف
  await new Promise((r) => setTimeout(r, 350))

  recorder.stop()
  await stopped
  stream.getVideoTracks().forEach((t) => t.stop())

  return { blob: new Blob(chunks, { type: mime.mimeType.split(';')[0] }), mimeType: mime.mimeType, ext: mime.ext }
}
