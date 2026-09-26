import { create } from 'zustand'

export interface ExportResult {
  url: string
  fileName: string
  ext: 'mp4' | 'webm'
  sizeBytes: number
  codecLabel: string
}

export type ExportStatus = 'idle' | 'recording' | 'done' | 'error'

interface ExportState {
  status: ExportStatus
  progress: number
  result: ExportResult | null
  error: string | null

  setRecording: () => void
  setProgress: (p: number) => void
  setResult: (r: ExportResult) => void
  setError: (msg: string) => void
  reset: () => void
}

export const useExportStore = create<ExportState>((set) => ({
  status: 'idle',
  progress: 0,
  result: null,
  error: null,

  setRecording: () => set({ status: 'recording', progress: 0, error: null }),
  setProgress: (progress) => set({ progress }),
  setResult: (result) => set({ status: 'done', result, progress: 1 }),
  setError: (error) => set({ status: 'error', error }),
  reset: () => set({ status: 'idle', progress: 0, error: null }),
}))
