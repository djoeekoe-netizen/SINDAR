/** أدوات تنسيق مشتركة */

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

export function toArabicDigits(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)])
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** عدد الحروف بدون التشكيل — لتوزيع التوقيت التقديري */
export function charCount(s: string): number {
  // إزالة التشكيل العربي والتطويل والرموز الوقفية
  return s
    .replace(/[\u064B-\u065F\u0670\u0640\u06D6-\u06ED\u08F0-\u08F3]/g, '')
    .replace(/\s+/g, ' ')
    .trim().length
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
