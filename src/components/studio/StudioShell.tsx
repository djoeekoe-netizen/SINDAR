import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { AudioEngine } from '../../lib/audio/AudioEngine'
import { renderFrame } from '../../lib/canvas/renderFrame'
import { CANVAS_H, CANVAS_W } from '../../lib/canvas/design'
import { ensureFonts } from '../../lib/fonts'
import { getRenderStrings } from '../../i18n'
import { useDesignStore } from '../../store/useDesignStore'
import { useEngineStore } from '../../store/useEngineStore'
import { useUIStore } from '../../store/useUIStore'

/**
 * المضيف الأبدي للاستوديو — المكان الوحيد الذي تعيش فيه عناصر الوسائط:
 * الكانفس يُركَّب مرة واحدة (داخل PreviewCard اللاصقة) ولا يُفكك أبداً
 * عند التنقل بين الخطوات، وكذلك فيديو/صورة الخلفية المخفيان هنا.
 * هذا هو الحل الجذري لمشكلة "اختفاء العناصر" عند تبديل التابات.
 */

export interface StudioRefs {
  canvasRef: RefObject<HTMLCanvasElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  imgRef: RefObject<HTMLImageElement | null>
  engine: AudioEngine
}

const StudioContext = createContext<StudioRefs | null>(null)

export function useStudio(): StudioRefs {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error('useStudio must be used inside StudioShell')
  return ctx
}

export function StudioShell({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  if (!engineRef.current) engineRef.current = new AudioEngine()
  const engine = engineRef.current

  useEffect(() => {
    useEngineStore.getState().setEngine(engine)
    void ensureFonts()

    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const { timeline, meta } = useEngineStore.getState()
      const design = useDesignStore.getState()
      const lang = useUIStore.getState().lang

      const t = timeline ? engine.currentTimeMs() : performance.now()
      if (timeline && engine.isPlaying && t >= timeline.startMs + timeline.durationMs) {
        engine.finish()
      }

      renderFrame({
        ctx,
        timeline,
        tMs: t,
        design,
        meta,
        media: { video: videoRef.current, image: imgRef.current },
        analyserData: engine.getFrequencyData(),
        strings: getRenderStrings(lang),
      })
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  return (
    <StudioContext.Provider value={{ canvasRef, videoRef, imgRef, engine }}>
      {children}
      {/* عناصر وسائط خفية — حية طوال عمر الاستوديو ولا تُفكك مع الخطوات */}
      <video ref={videoRef} className="studio-media" muted loop playsInline preload="auto" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} className="studio-media" alt="" />
    </StudioContext.Provider>
  )
}
