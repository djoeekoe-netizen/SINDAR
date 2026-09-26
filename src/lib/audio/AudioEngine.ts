/**
 * محرك الصوت — ساعة التطبيق الرئيسية.
 *
 * القاعدة الذهبية: كل مزامنة (نص، كاراوكي، موجات) تُشتق من ساعة AudioContext،
 * لذلك لا يوجد أي انجراف بين الصوت والصورة.
 *
 * يدعم أيضاً "وضعاً افتراضياً" بدون ملف صوتي (النموذج التجريبي):
 * تسع ساعة performance.now بنفس الواجهة تماماً.
 */

type EngineListener = () => void

export interface LoadOptions {
  startMs: number
  endMs: number
  virtualDurationMs?: number
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private gainNode: GainNode | null = null
  analyser: AnalyserNode | null = null
  private streamDest: MediaStreamAudioDestinationNode | null = null
  private freqData: Uint8Array | null = null

  private startBoundMs = 0
  private endBoundMs = 0
  private virtualDurationMs = 0
  private virtual = false

  private offsetMs = 0
  private startedAt = 0
  private virtualStart = 0
  private _playing = false

  private listeners = new Set<EngineListener>()
  onEnded: (() => void) | null = null

  subscribe(fn: EngineListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    this.listeners.forEach((l) => l())
  }

  /** يُنشأ عند أول استخدام — decodeAudioData يعمل حتى لو كان السياق suspended */
  ensureCtx(): AudioContext {
    if (!this.ctx) {
      const AC: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      this.gainNode = this.ctx.createGain()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.smoothingTimeConstant = 0.82
      this.gainNode.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount)
    }
    return this.ctx
  }

  async decode(ab: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureCtx()
    // decodeAudioData يستهلك الـ buffer — ننسخه ليبقى الأصل صالحاً لإعادة المحاولة
    return ctx.decodeAudioData(ab.slice(0))
  }

  load(buffer: AudioBuffer | null, opts: LoadOptions): void {
    this.stopSource()
    this.buffer = buffer
    this.virtual = !buffer
    this.startBoundMs = opts.startMs
    this.endBoundMs = opts.endMs
    if (this.virtual) this.virtualDurationMs = opts.virtualDurationMs ?? Math.max(opts.endMs, 1)
    this.offsetMs = opts.startMs
    this._playing = false
    this.emit()
  }

  get isPlaying(): boolean {
    return this._playing
  }

  get bounds(): { startMs: number; endMs: number } {
    return { startMs: this.startBoundMs, endMs: this.endBoundMs }
  }

  async play(fromMs?: number): Promise<void> {
    if (fromMs != null) this.offsetMs = fromMs

    if (this.virtual) {
      this.virtualStart = performance.now()
      this._playing = true
      this.emit()
      return
    }
    if (!this.buffer) return

    const ctx = this.ensureCtx()
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        /* تجاهل — إيماءة المستخدم ستُكمل التفعيل */
      }
    }
    this.stopSource()
    const src = ctx.createBufferSource()
    src.buffer = this.buffer
    src.connect(this.gainNode!)
    const offsetSec = Math.max(0, this.offsetMs / 1000)
    src.onended = () => {
      if (this.source === src && this._playing) this.finish()
    }
    try {
      src.start(0, offsetSec)
    } catch {
      return
    }
    this.source = src
    this.startedAt = ctx.currentTime
    this._playing = true
    this.emit()
  }

  pause(): void {
    if (!this._playing) return
    this.offsetMs = this.currentTimeMs()
    this.stopSource()
    this._playing = false
    this.emit()
  }

  toggle(): void {
    if (this._playing) this.pause()
    else void this.play()
  }

  seek(ms: number): void {
    const wasPlaying = this._playing
    if (wasPlaying) {
      this.stopSource()
      this._playing = false
    }
    this.offsetMs = Math.max(0, Math.min(ms, this.totalMs()))
    if (wasPlaying) void this.play()
    else this.emit()
  }

  /** نهاية طبيعية للتشغيل */
  finish(): void {
    this.stopSource()
    this._playing = false
    this.offsetMs = this.endBoundMs
    this.emit()
    this.onEnded?.()
  }

  currentTimeMs(): number {
    if (this.virtual) {
      return this._playing ? this.offsetMs + (performance.now() - this.virtualStart) : this.offsetMs
    }
    if (!this.ctx || !this._playing) return this.offsetMs
    return this.offsetMs + (this.ctx.currentTime - this.startedAt) * 1000
  }

  totalMs(): number {
    return this.virtual ? this.virtualDurationMs : (this.buffer?.duration ?? 0) * 1000
  }

  /** بيانات الترددات للـ Visualizer — null عند التوقف */
  getFrequencyData(): Uint8Array | null {
    if (!this.analyser || !this._playing || this.virtual) return null
    this.analyser.getByteFrequencyData(this.freqData as Uint8Array<ArrayBuffer>)
    return this.freqData
  }

  /** مسار صوتي مخصص للتسجيل (يُنشأ مرة واحدة ويبقى متصلاً) */
  getRecordTrack(): MediaStreamTrack | null {
    if (this.virtual) return null
    const ctx = this.ensureCtx()
    if (!this.streamDest) {
      this.streamDest = ctx.createMediaStreamDestination()
      this.gainNode!.connect(this.streamDest)
    }
    return this.streamDest.stream.getAudioTracks()[0] ?? null
  }

  private stopSource(): void {
    const s = this.source
    this.source = null
    try {
      s?.stop()
    } catch {
      /* المصدر توقف مسبقاً */
    }
  }
}
