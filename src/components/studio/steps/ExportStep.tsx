import { useMemo } from 'react'
import { useT } from '../../../i18n'
import { formatBytes, formatTime, toArabicDigits } from '../../../lib/format'
import { pickMime, recordCanvas } from '../../../lib/recorder/VideoRecorder'
import { ensureFonts } from '../../../lib/fonts'
import { useEngineStore } from '../../../store/useEngineStore'
import { useExportStore } from '../../../store/useExportStore'
import { useUIStore } from '../../../store/useUIStore'
import { cn } from '../../../lib/cn'
import { ErrorBox, InfoNote, ProgressBar, Spinner } from '../../ui/controls'
import { GlassButton, GlassCard } from '../../ui/Glass'
import { IconDownload, IconExport, IconRetry, IconShare } from '../../ui/icons'
import { useStudio } from '../StudioShell'

export function ExportStep() {
  const t = useT()
  const { canvasRef } = useStudio()
  const timeline = useEngineStore((s) => s.timeline)
  const meta = useEngineStore((s) => s.meta)
  const { status, progress, result, error } = useExportStore()
  const setStep = useUIStore((s) => s.setStep)

  const mime = useMemo(() => pickMime(), [])

  const start = async () => {
    const { engine, timeline: tl } = useEngineStore.getState()
    const canvas = canvasRef.current
    if (!engine || !tl || !canvas) return
    const m = pickMime()
    if (!m) {
      useExportStore.getState().setError(t('errors.recorder'))
      return
    }
    useExportStore.getState().setRecording()
    try {
      await ensureFonts()
      const rec = await recordCanvas({
        canvas,
        engine,
        timeline: tl,
        mime: m,
        onProgress: (p) => useExportStore.getState().setProgress(p),
      })
      const prev = useExportStore.getState().result
      if (prev) URL.revokeObjectURL(prev.url)
      const name = meta?.surahName || 'sindar'
      useExportStore.getState().setResult({
        url: URL.createObjectURL(rec.blob),
        fileName: `sindar-${name}-${meta?.fromAyah ?? 1}-${meta?.toAyah ?? 1}.${rec.ext}`,
        ext: rec.ext,
        sizeBytes: rec.blob.size,
        codecLabel: m.label,
      })
    } catch {
      useExportStore.getState().setError(t('errors.record'))
    }
  }

  const share = async () => {
    if (!result) return
    try {
      const blob = await fetch(result.url).then((r) => r.blob())
      const file = new File([blob], result.fileName, { type: blob.type })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'SINDAR' })
      }
    } catch {
      /* المستخدم ألغى المشاركة أو غير مدعومة */
    }
  }

  if (!timeline || !meta) {
    return (
      <div className="step-page">
        <GlassCard className="empty-state rise-in">
          <span className="empty-state__icon">
            <IconExport size={30} />
          </span>
          <h2>{t('export.noProject')}</h2>
          <p>{t('export.noProjectHint')}</p>
          <GlassButton variant="gold" onClick={() => setStep('setup')}>
            {t('export.goSetup')}
          </GlassButton>
        </GlassCard>
      </div>
    )
  }

  const recording = status === 'recording'

  return (
    <div className="step-page">
      <GlassCard className={cn('step-card export-card rise-in', recording && 'export-card--recording')}>
        <h2 className="step-card__title">{t('export.title')}</h2>

        <dl className="summary">
          <div>
            <dt>{t('export.surah')}</dt>
            <dd>{meta.surahName}</dd>
          </div>
          <div>
            <dt>{t('export.range')}</dt>
            <dd>
              {toArabicDigits(meta.fromAyah)} — {toArabicDigits(meta.toAyah)}
            </dd>
          </div>
          <div>
            <dt>{t('export.duration')}</dt>
            <dd dir="ltr">{formatTime(timeline.durationMs)}</dd>
          </div>
          <div>
            <dt>{t('export.source')}</dt>
            <dd>{meta.reciterName}</dd>
          </div>
          <div>
            <dt>{t('export.quality')}</dt>
            <dd dir="ltr">1080×1920 · 30fps · {mime?.label ?? '—'}</dd>
          </div>
        </dl>

        <InfoNote>{t('export.note')}</InfoNote>

        {error && <ErrorBox message={error} />}

        {status === 'done' && result ? (
          <div className="export-result rise-in">
            <h3 className="export-result__title">{t('export.done')}</h3>
            <video className="export-result__video" src={result.url} controls playsInline />
            <p className="export-result__meta" dir="ltr">
              {result.fileName} · {formatBytes(result.sizeBytes)} · {result.codecLabel}
            </p>
            <p className="export-result__hint">{t('export.hint')}</p>
            <div className="export-result__actions">
              <a className="glass-btn glass-btn--gold glass-btn--lg" href={result.url} download={result.fileName}>
                <IconDownload size={18} />
                {t('export.download')}
              </a>
              <GlassButton onClick={() => void share()}>
                <IconShare size={18} />
                {t('export.share')}
              </GlassButton>
              <GlassButton onClick={() => void start()}>
                <IconRetry size={18} />
                {t('export.rerecord')}
              </GlassButton>
            </div>
          </div>
        ) : recording ? (
          <div className="export-progress">
            <div className="export-progress__head">
              <Spinner size={18} />
              <span>{t('export.recording')}</span>
              <span className="export-progress__pct" dir="ltr">
                {Math.round(progress * 100)}%
              </span>
            </div>
            <ProgressBar value={progress} />
            <p className="export-progress__hint">{t('export.note')}</p>
          </div>
        ) : (
          <div className="step-card__cta">
            <GlassButton variant="gold" size="lg" disabled={!mime} onClick={() => void start()}>
              <IconExport size={20} />
              {t('export.start')}
            </GlassButton>
          </div>
        )}
      </GlassCard>
    </div>
  )
}
