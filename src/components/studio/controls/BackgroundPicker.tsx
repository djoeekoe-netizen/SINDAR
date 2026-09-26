import { useRef } from 'react'
import { useT } from '../../../i18n'
import { GRADIENTS } from '../../../lib/canvas/design'
import { useDesignStore } from '../../../store/useDesignStore'
import { cn } from '../../../lib/cn'
import { Labeled, Slider } from '../../ui/controls'
import { IconImage, IconVideo } from '../../ui/icons'
import { useStudio } from '../StudioShell'

/** خلفيات الفيديو: تدرجات جاهزة / صورة ثابتة (Ken Burns) / فيديو مرفوع (loop) + تعتيم */
export function BackgroundPicker() {
  const t = useT()
  const { videoRef, imgRef } = useStudio()
  const bg = useDesignStore((s) => s.background)
  const setBackground = useDesignStore((s) => s.setBackground)

  const imgUrlRef = useRef<string | null>(null)
  const vidUrlRef = useRef<string | null>(null)

  const pickImage = (f: File) => {
    if (imgUrlRef.current) URL.revokeObjectURL(imgUrlRef.current)
    const url = URL.createObjectURL(f)
    imgUrlRef.current = url
    if (imgRef.current) {
      imgRef.current.src = url
    }
    setBackground({ type: 'image' })
  }

  const pickVideo = (f: File) => {
    if (vidUrlRef.current) URL.revokeObjectURL(vidUrlRef.current)
    const url = URL.createObjectURL(f)
    vidUrlRef.current = url
    const v = videoRef.current
    if (v) {
      v.src = url
      v.load()
      void v.play().catch(() => undefined)
    }
    setBackground({ type: 'video' })
  }

  return (
    <div className="bg-picker">
      <Labeled label={t('design.bgGradient')}>
        <div className="bg-swatches">
          {GRADIENTS.map((g) => (
            <button
              key={g.id}
              type="button"
              title={g.nameAr}
              aria-label={g.nameAr}
              className={cn('bg-swatch', bg.gradientId === g.id && bg.type === 'gradient' && 'bg-swatch--on')}
              style={{
                background: `linear-gradient(135deg, ${g.stops[0]}, ${g.stops[1]} 55%, ${g.stops[2]})`,
              }}
              onClick={() => setBackground({ type: 'gradient', gradientId: g.id })}
            >
              <span className="bg-swatch__glow" style={{ background: g.glow }} />
            </button>
          ))}
        </div>
      </Labeled>

      <div className="bg-actions">
        <label className="media-btn">
          <IconImage size={18} />
          <span>{t('design.uploadImage')}</span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) pickImage(f)
              e.target.value = ''
            }}
          />
        </label>
        <label className="media-btn">
          <IconVideo size={18} />
          <span>{t('design.uploadVideo')}</span>
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) pickVideo(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {bg.type !== 'gradient' && (
        <p className="bg-active-note">
          {bg.type === 'image' ? t('design.bgImage') : t('design.bgVideo')} ✓
        </p>
      )}

      <Labeled label={`${t('design.scrim')} — ${Math.round(bg.scrim * 100)}%`}>
        <Slider value={bg.scrim} min={0} max={0.9} step={0.05} onInput={(v) => setBackground({ scrim: v })} />
      </Labeled>
    </div>
  )
}
