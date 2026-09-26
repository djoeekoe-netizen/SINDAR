/** تحميل خطوط المصحف والواجهة قبل أول إطار/تصدير — مع مهلة أمان */

const SAMPLE_AR = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'

export async function ensureFonts(): Promise<void> {
  if (typeof document === 'undefined') return
  try {
    const loads = [
      document.fonts.load('400 64px "Amiri Quran"', SAMPLE_AR),
      document.fonts.load('400 64px "Scheherazade New"', SAMPLE_AR),
      document.fonts.load('400 64px "Noto Naskh Arabic"', SAMPLE_AR),
      document.fonts.load('600 42px "IBM Plex Sans Arabic"', 'سورة الفاتحة'),
      document.fonts.load('400 34px Inter', 'Aa Bb 123'),
    ]
    await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 4500))])
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))])
  } catch {
    /* نكمل بالخطوط المتاحة */
  }
}
