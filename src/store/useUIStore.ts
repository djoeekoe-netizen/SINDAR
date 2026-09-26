import { create } from 'zustand'

export type Step = 'setup' | 'design' | 'export'
export type Lang = 'ar' | 'en'

interface UIState {
  step: Step
  lang: Lang
  setStep: (s: Step) => void
  setLang: (l: Lang) => void
  toggleLang: () => void
}

export const useUIStore = create<UIState>((set) => ({
  step: 'setup',
  lang: 'ar',
  setStep: (step) => set({ step }),
  setLang: (lang) => set({ lang }),
  toggleLang: () => set((s) => ({ lang: s.lang === 'ar' ? 'en' : 'ar' })),
}))
