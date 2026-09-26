import { create } from 'zustand'
import type { AudioEngine } from '../lib/audio/AudioEngine'
import type { ProjectMeta, Timeline } from '../lib/quran/types'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'

interface EngineState {
  engine: AudioEngine | null
  timeline: Timeline | null
  meta: ProjectMeta | null
  status: EngineStatus
  /** مفتاح مرحلة التحميل الحالية (i18n) */
  loadStage: string | null
  errorMsg: string | null

  setEngine: (e: AudioEngine) => void
  beginLoad: (stage: string) => void
  setStage: (stage: string) => void
  setReady: (timeline: Timeline, meta: ProjectMeta) => void
  setError: (msg: string) => void
  /** تحديث نصوص الآيات (مثلاً عند تغيير الترجمة) دون إعادة بناء المزامنة */
  patchVerses: (verses: Timeline['verses']) => void
  reset: () => void
}

export const useEngineStore = create<EngineState>((set) => ({
  engine: null,
  timeline: null,
  meta: null,
  status: 'idle',
  loadStage: null,
  errorMsg: null,

  setEngine: (engine) => set({ engine }),
  beginLoad: (loadStage) => set({ status: 'loading', loadStage, errorMsg: null }),
  setStage: (loadStage) => set({ loadStage }),
  setReady: (timeline, meta) => set({ status: 'ready', timeline, meta, loadStage: null, errorMsg: null }),
  setError: (errorMsg) => set({ status: 'error', errorMsg, loadStage: null }),
  patchVerses: (verses) =>
    set((s) => (s.timeline ? { timeline: { ...s.timeline, verses } } : {})),
  reset: () => set({ status: 'idle', timeline: null, meta: null, loadStage: null, errorMsg: null }),
}))
