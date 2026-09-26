import { useCallback, useState } from 'react'
import { useT, tr } from '../../../i18n'
import { getChapter } from '../../../lib/quran/chapters'
import {
  fetchAudioBuffer,
  fetchChapterAudioInfo,
  fetchVerses,
  networkAudioUrl,
  resolveReciter,
} from '../../../lib/quran/api'
import { getSampleVerses } from '../../../lib/quran/samples'
import { buildTimeline } from '../../../lib/quran/timeline'
import type { ProjectMeta, VerseTimestamp } from '../../../lib/quran/types'
import { useEngineStore } from '../../../store/useEngineStore'
import { useSetupStore } from '../../../store/useSetupStore'
import { useUIStore } from '../../../store/useUIStore'

export interface LoaderState {
  loading: boolean
  stage: string | null
  error: string | null
}

/** بناء المشروع: آيات + صوت + تايملاين — بمراحل واضحة وأخطاء ودية */
export function useProjectLoader(): LoaderState & { build: () => void; loadSample: () => void } {
  const t = useT()
  const [state, setState] = useState<LoaderState>({ loading: false, stage: null, error: null })

  const fail = useCallback(
    (msg: string) => setState({ loading: false, stage: null, error: msg }),
    [],
  )

  const build = useCallback(async () => {
    const setup = useSetupStore.getState()
    const engine = useEngineStore.getState().engine
    if (!engine) return

    const failKey = (key: string) => fail(t(key))

    if (!setup.surahId) return failKey('errors.surah')
    const chapter = getChapter(setup.surahId)!
    const from = Number(setup.fromAyah)
    const to = Number(setup.toAyah)
    if (!setup.fromAyah || !setup.toAyah) return failKey('errors.range')
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) return failKey('errors.range')
    if (to > chapter.versesCount) return failKey('errors.range')
    if (setup.audioMode === 'reciter' && !setup.reciterId) return failKey('errors.reciter')
    if (setup.audioMode === 'upload' && !setup.uploadedFile) return failKey('errors.file')

    const E = useEngineStore.getState()
    E.beginLoad('stage.verses')
    setState({ loading: true, stage: 'stage.verses', error: null })

    try {
      let verses
      try {
        verses = await fetchVerses(setup.surahId, from, to, setup.translationId)
      } catch {
        throw new Error('errors.verses')
      }

      let audioBuffer: AudioBuffer | null = null
      let timestamps: VerseTimestamp[] | null = null
      let reciterName = ''

      if (setup.audioMode === 'reciter') {
        const reciter = resolveReciter(setup.reciterId)
        if (!reciter) throw new Error('errors.reciter')
        reciterName = reciter.nameAr

        setState((s) => ({ ...s, stage: 'stage.audioInfo' }))
        E.setStage('stage.audioInfo')

        let info = null
        if (reciter.source === 'quran') {
          info = await fetchChapterAudioInfo(reciter.qcId!, setup.surahId)
        }

        setState((s) => ({ ...s, stage: 'stage.audio' }))
        E.setStage('stage.audio')

        /** سلسلة الصوت: ملف Quran.com (بتوقيتاته الرسمية) → طبعة شبكة مكافئة (تقديري) */
        const tryLoad = async (url: string): Promise<AudioBuffer> =>
          engine.decode(await fetchAudioBuffer(url))

        try {
          if (reciter.source === 'quran') {
            if (info) {
              timestamps = info.timestamps
              try {
                audioBuffer = await tryLoad(info.audioUrl)
              } catch {
                // الملف الأصلي تعذّر (CORS/شبكة) — طبعة مكافئة بديلة، والتوقيت يصبح تقديرياً
                timestamps = null
                if (reciter.fallbackEdition) {
                  audioBuffer = await tryLoad(networkAudioUrl(reciter.fallbackEdition, setup.surahId))
                }
              }
            } else if (reciter.fallbackEdition) {
              audioBuffer = await tryLoad(networkAudioUrl(reciter.fallbackEdition, setup.surahId))
            }
          } else {
            audioBuffer = await tryLoad(networkAudioUrl(reciter.edition!, setup.surahId))
          }
        } catch {
          throw new Error('errors.audio')
        }

        if (!audioBuffer) throw new Error('errors.audio')
      } else {
        reciterName = tr('ar', 'misc.uploaded')
        setState((s) => ({ ...s, stage: 'stage.audio' }))
        E.setStage('stage.audio')
        try {
          audioBuffer = await engine.decode(await setup.uploadedFile!.arrayBuffer())
        } catch {
          throw new Error('errors.decode')
        }
      }

      setState((s) => ({ ...s, stage: 'stage.build' }))
      E.setStage('stage.build')

      const timeline = buildTimeline({
        verses,
        surahId: setup.surahId,
        audioBuffer,
        timestamps,
        audioSource: setup.audioMode === 'reciter' ? 'api' : 'upload',
      })

      engine.load(audioBuffer, {
        startMs: timeline.startMs,
        endMs: timeline.startMs + timeline.durationMs,
      })

      const meta: ProjectMeta = {
        surahId: setup.surahId,
        surahName: setup.customName.trim() || chapter.nameAr,
        fromAyah: from,
        toAyah: to,
        reciterName,
        translationName:
          setup.translationId === 131 ? tr('ar', 'setup.transKhattab') : tr('ar', 'setup.transSaheeh'),
      }

      useEngineStore.getState().setReady(timeline, meta)
      setState({ loading: false, stage: null, error: null })
      useUIStore.getState().setStep('design')
    } catch (e) {
      const key = e instanceof Error ? e.message : ''
      const msg = key in ERR_KEYS ? t(key) : String(key)
      useEngineStore.getState().setError(msg)
      setState({ loading: false, stage: null, error: msg })
    }
  }, [t])

  const loadSample = useCallback(() => {
    const engine = useEngineStore.getState().engine
    if (!engine) return
    const verses = getSampleVerses(112)
    const timeline = buildTimeline({
      verses,
      surahId: 112,
      audioBuffer: null,
      timestamps: null,
      audioSource: 'sample',
    })
    engine.load(null, {
      startMs: timeline.startMs,
      endMs: timeline.startMs + timeline.durationMs,
    })
    useSetupStore.setState({
      surahId: 112,
      customName: 'الإخلاص',
      fromAyah: '1',
      toAyah: '4',
      audioMode: 'reciter',
      uploadedFile: null,
    })
    useEngineStore.getState().setReady(timeline, {
      surahId: 112,
      surahName: 'الإخلاص',
      fromAyah: 1,
      toAyah: 4,
      reciterName: tr('ar', 'misc.sample'),
      translationName: '—',
    })
    useUIStore.getState().setStep('design')
  }, [])

  return { ...state, build, loadSample }
}

const ERR_KEYS: Record<string, true> = {
  'errors.verses': true,
  'errors.audio': true,
  'errors.decode': true,
  'errors.reciter': true,
}
