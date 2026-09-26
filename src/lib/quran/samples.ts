import type { ApiVerse } from './types'

/**
 * نماذج تجريبية مضمّنة — تعمل دون اتصال بالإنترنت ودون صوت
 * (ساعة افتراضية + توقيت تقديري)، لغرض تجربة التصميم والتصدير الصامت.
 */

interface SampleSurah {
  surahId: number
  verses: Array<[string, string]> // [النص المشكول, الترجمة]
}

const SAMPLE_SURAHS: SampleSurah[] = [
  {
    surahId: 112,
    verses: [
      ['قُلْ هُوَ اللَّهُ أَحَدٌ', 'Say, "He is Allah, [who is] One,'],
      ['اللَّهُ الصَّمَدُ', 'Allah, the Eternal Refuge.'],
      ['لَمْ يَلِدْ وَلَمْ يُولَدْ', 'He neither begets nor is born,'],
      ['وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ', 'Nor is there to Him any equivalent."'],
    ],
  },
  {
    surahId: 108,
    verses: [
      ['إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ', 'Indeed, We have granted you al-Kawthar.'],
      ['فَصَلِّ لِرَبِّكَ وَانْحَرْ', 'So pray to your Lord and sacrifice [to Him alone].'],
      ['إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ', 'Indeed, your enemy is the one cut off.'],
    ],
  },
  {
    surahId: 1,
    verses: [
      ['بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ', 'In the name of Allah, the Entirely Merciful, the Especially Merciful.'],
      ['الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ', '[All] praise is [due] to Allah, Lord of the worlds -'],
      ['الرَّحْمَٰنِ الرَّحِيمِ', 'The Entirely Merciful, the Especially Merciful,'],
      ['مَالِكِ يَوْمِ الدِّينِ', 'Sovereign of the Day of Recompense.'],
      ['إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ', 'It is You we worship and You we ask for help.'],
      ['اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ', 'Guide us to the straight path -'],
      [
        'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ',
        'The path of those upon whom You have bestowed favor, not of those who have earned [Your] anger or of those who are astray.',
      ],
    ],
  },
]

export function getSampleVerses(surahId: number): ApiVerse[] {
  const surah = SAMPLE_SURAHS.find((s) => s.surahId === surahId) ?? SAMPLE_SURAHS[0]
  return surah.verses.map(([text, translation], i) => ({
    number: i + 1,
    key: `${surah.surahId}:${i + 1}`,
    textUthmani: text,
    translation,
    words: text.split(/\s+/).map((w, j) => ({ position: j + 1, charType: 'word', text: w })),
  }))
}

export const SAMPLE_SURAH_IDS = SAMPLE_SURAHS.map((s) => s.surahId)
