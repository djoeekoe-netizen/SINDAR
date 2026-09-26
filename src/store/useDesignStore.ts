import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_DESIGN, type DesignSettings } from '../lib/canvas/design'

/**
 * تفضيلات التصميم — تُحفظ في localStorage (الملفات الوسائطية لا تُحفظ،
 * والخلفية تعود للتدرج تلقائياً عند عدم توفر الوسيط).
 */
interface DesignState extends DesignSettings {
  set: <K extends keyof DesignSettings>(key: K, value: DesignSettings[K]) => void
  setVisualizer: (patch: Partial<DesignSettings['visualizer']>) => void
  setBackground: (patch: Partial<DesignSettings['background']>) => void
}

export const useDesignStore = create<DesignState>()(
  persist(
    (set) => ({
      ...DEFAULT_DESIGN,
      set: (key, value) => set({ [key]: value } as unknown as Partial<DesignState>),
      setVisualizer: (patch) => set((s) => ({ visualizer: { ...s.visualizer, ...patch } })),
      setBackground: (patch) => set((s) => ({ background: { ...s.background, ...patch } })),
    }),
    {
      name: 'sindar-design',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
)
