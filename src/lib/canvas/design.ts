/** إعدادات التصميم + الهوية البصرية للفيديو (تُستهلك من محرك الرسم والمخزن معاً) */

export type GradientId = 'gold' | 'emerald' | 'night' | 'sky' | 'sand' | 'royal'
export type FontId = 'amiri-quran' | 'scheherazade' | 'noto-naskh'
export type HighlightColor = 'gold' | 'emerald' | 'white'
export type RevealMode = 'karaoke' | 'fade' | 'scale' | 'pop3d'
export type VisStyle = 'bars' | 'wave'
export type VisPosition = 'bottom' | 'behind'
export type DisplayMode = 'normal' | 'notification'
export type BackgroundType = 'gradient' | 'image' | 'video'

export interface DesignSettings {
  background: { type: BackgroundType; gradientId: GradientId; scrim: number }
  displayMode: DisplayMode
  notifAppName: string
  font: FontId
  fontSize: number
  highlight: HighlightColor
  textShadow: boolean
  showTranslation: boolean
  reveal: RevealMode
  visualizer: { on: boolean; style: VisStyle; position: VisPosition; color: HighlightColor }
  showBadge: boolean
}

export const DEFAULT_DESIGN: DesignSettings = {
  background: { type: 'gradient', gradientId: 'emerald', scrim: 0.35 },
  displayMode: 'normal',
  notifAppName: 'SINDAR',
  font: 'amiri-quran',
  fontSize: 72,
  highlight: 'gold',
  textShadow: true,
  showTranslation: true,
  reveal: 'karaoke',
  visualizer: { on: true, style: 'bars', position: 'bottom', color: 'gold' },
  showBadge: true,
}

export interface GradientPreset {
  id: GradientId
  nameAr: string
  nameEn: string
  stops: [string, string, string]
  glow: string
}

export const GRADIENTS: GradientPreset[] = [
  { id: 'gold', nameAr: 'ذهبي فاخر', nameEn: 'Royal Gold', stops: ['#241B04', '#6E5518', '#B98F35'], glow: '#F5D98B' },
  { id: 'emerald', nameAr: 'زمردي داكن', nameEn: 'Deep Emerald', stops: ['#02100B', '#073F2E', '#0B5A41'], glow: '#34D399' },
  { id: 'night', nameAr: 'ليلي بنفسجي', nameEn: 'Violet Night', stops: ['#0B0714', '#241640', '#3B1D5E'], glow: '#A78BFA' },
  { id: 'sky', nameAr: 'أزرق سماوي', nameEn: 'Sky Blue', stops: ['#04121F', '#0C3B5C', '#1E6E9E'], glow: '#7DD3FC' },
  { id: 'sand', nameAr: 'رملي دافئ', nameEn: 'Warm Sand', stops: ['#1C1206', '#5C3A1E', '#B4834A'], glow: '#EAD9B0' },
  { id: 'royal', nameAr: 'أسود مخملي', nameEn: 'Velvet Black', stops: ['#050507', '#151522', '#26263A'], glow: '#C9C9E8' },
]

export function getGradient(id: GradientId): GradientPreset {
  return GRADIENTS.find((g) => g.id === id) ?? GRADIENTS[1]
}

export const QURAN_FONTS: Record<FontId, { labelAr: string; labelEn: string; css: string }> = {
  'amiri-quran': { labelAr: 'عثماني (أميري قرآن)', labelEn: 'Uthmani (Amiri Quran)', css: '"Amiri Quran", "Scheherazade New", serif' },
  scheherazade: { labelAr: 'نسخ (شهرزاد)', labelEn: 'Naskh (Scheherazade)', css: '"Scheherazade New", "Noto Naskh Arabic", serif' },
  'noto-naskh': { labelAr: 'نسخ حديث (نوتو)', labelEn: 'Modern Naskh (Noto)', css: '"Noto Naskh Arabic", "Scheherazade New", serif' },
}

export const HIGHLIGHT_COLORS: Record<HighlightColor, { nameAr: string; nameEn: string; hex: string }> = {
  gold: { nameAr: 'ذهبي', nameEn: 'Gold', hex: '#E8C97A' },
  emerald: { nameAr: 'زمردي', nameEn: 'Emerald', hex: '#34D399' },
  white: { nameAr: 'أبيض ناصع', nameEn: 'White', hex: '#FFFFFF' },
}

export function highlightHex(c: HighlightColor): string {
  return HIGHLIGHT_COLORS[c].hex
}

/** أبعاد الكانفس الثابتة */
export const CANVAS_W = 1080
export const CANVAS_H = 1920
