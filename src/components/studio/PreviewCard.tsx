import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { clamp, formatTime } from '../../lib/format'
import { useEngineStore } from '../../store/useEngineStore'
import { useExportStore } from '../../store/useExportStore'
import { cn } from '../../lib/cn'
import { GlassButton } from '../ui/Glass'
import { IconClose, IconExpand, IconPause, IconPlay } from '../ui/icons'
import { useStudio } from './StudioShell'

/** المعاينة اللاصقة — الكانفس 1080×1920 مُصغّر بـ CSS، وأزرار التحكم */
export function PreviewCard() {
  const t = useT()
  const { canvasRef, engine } = useStudio()
  const timeline = useEngineStore((s) => s.timeline)
  const recording = useExportStore((s) => s.status === 'recording')

  const [playing, setPlaying] = useState(false)
  const [tMs, setTMs] = useState(0)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => engine.subscribe(() => setPlaying(engine.isPlaying)), [engine])

  useEffect(() => {
    const id = window.setInterval(() => setTMs(engine.currentTimeMs()), 200)
    return () => window.clearInterval(id)
  }, [engine])

  const startMs = timeline?.startMs ?? 0
  const duration = timeline?.durationMs ?? 0
  const pos = clamp(tMs - startMs, 0, duration)

  /** تشغيل ذكي: عند نهاية المقطع يعيد من البداية */
  const smartToggle = () => {
    if (!timeline || recording) return
    if (engine.isPlaying) {
      engine.pause()
    } else {
      const atEnd = engine.currentTimeMs() >= timeline.startMs + timeline.durationMs - 80
      void engine.play(atEnd ? timeline.startMs : undefined)
    }
  }

  return (
    <section className={cn('preview-card', expanded && 'preview-card--expanded')}>
      <div className="preview-card__head">
        <span className="preview-card__live">
          <span className="live-dot" />
          {t('preview.live')}
        </span>
        {recording && (
          <span className="rec-badge">
            <span className="rec-dot" />
            {t('preview.recording')}
          </span>
        )}
      </div>

      <div className="preview-card__stage">
        <canvas ref={canvasRef} className="preview-canvas" onClick={smartToggle} />
        {!playing && timeline && !recording && (
          <button
            type="button"
            className="preview-play"
            aria-label={t('preview.play')}
            onClick={smartToggle}
          >
            <IconPlay size={34} />
          </button>
        )}
      </div>

      <div className="preview-card__controls">
        <GlassButton
          size="icon"
          aria-label={playing ? t('preview.pause') : t('preview.play')}
          disabled={!timeline || recording}
          onClick={smartToggle}
        >
          {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        </GlassButton>

        <span className="preview-time" dir="ltr">
          {formatTime(pos)} / {formatTime(duration)}
        </span>

        <input
          type="range"
          className="ctl-range preview-scrub"
          dir="ltr"
          min={0}
          max={Math.max(duration, 1)}
          step={100}
          value={pos}
          disabled={!timeline || recording}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value)
            engine.seek(startMs + v)
          }}
        />

        <GlassButton
          size="icon"
          aria-label={expanded ? t('preview.collapse') : t('preview.expand')}
          onClick={() => setExpanded((x) => !x)}
        >
          {expanded ? <IconClose size={18} /> : <IconExpand size={18} />}
        </GlassButton>
      </div>
    </section>
  )
}
