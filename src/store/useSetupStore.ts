import { create } from 'zustand'

export type AudioMode = 'reciter' | 'upload'
export type TranslationId = 131 | 20

interface SetupState {
  surahId: number | null
  /** اسم مخصص يظهر على الفيديو — فراغ = الاسم الرسمي */
  customName: string
  /** نصوص حرّة — فارغة افتراضياً كما هو مطلوب */
  fromAyah: string
  toAyah: string
  audioMode: AudioMode
  reciterId: string | null
  uploadedFile: File | null
  translationId: TranslationId

  setSurah: (id: number, defaultName: string) => void
  setCustomName: (v: string) => void
  setFrom: (v: string) => void
  setTo: (v: string) => void
  setAudioMode: (m: AudioMode) => void
  setReciter: (id: string) => void
  setUploadedFile: (f: File | null) => void
  setTranslationId: (id: TranslationId) => void
}

export const useSetupStore = create<SetupState>((set) => ({
  surahId: null,
  customName: '',
  fromAyah: '',
  toAyah: '',
  audioMode: 'reciter',
  reciterId: null,
  uploadedFile: null,
  translationId: 131,

  setSurah: (id, defaultName) =>
    set((s) => ({
      surahId: id,
      customName: s.surahId === id ? s.customName : defaultName,
      fromAyah: '',
      toAyah: '',
    })),
  setCustomName: (customName) => set({ customName }),
  setFrom: (fromAyah) => set({ fromAyah: fromAyah.replace(/[^0-9]/g, '') }),
  setTo: (toAyah) => set({ toAyah: toAyah.replace(/[^0-9]/g, '') }),
  setAudioMode: (audioMode) => set({ audioMode }),
  setReciter: (reciterId) => set({ reciterId }),
  setUploadedFile: (uploadedFile) => set({ uploadedFile }),
  setTranslationId: (translationId) => set({ translationId }),
}))
