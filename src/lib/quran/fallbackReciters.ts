import type { Reciter } from './types'

/**
 * قراء احتياطيون من CDN مفتوح (cdn.islamic.network — بصيغة audio-surah كاملة).
 * يُستخدمون تلقائياً إذا تعذّر الوصول لقائمة Quran.com، أو كرابط صوت بديل
 * لقارئ من Quran.com عند فشل تحميل ملفه الأصلي.
 * التوقيت معهم "تقديري" (توزيع زمني بنسبة الحروف).
 */
export const NETWORK_RECITERS: Reciter[] = [
  { id: 'net-ar.alafasy', nameAr: 'مشاري راشد العفاسي', nameEn: 'Mishary Alafasy', source: 'network', edition: 'ar.alafasy', sync: 'estimated' },
  { id: 'net-ar.abdurrahmaansudais', nameAr: 'عبدالرحمن السديس', nameEn: 'Abdurrahman As-Sudais', source: 'network', edition: 'ar.abdurrahmaansudais', sync: 'estimated' },
  { id: 'net-ar.abdulbasitmurattal', nameAr: 'عبدالباسط عبدالصمد (مرتل)', nameEn: 'Abdul Basit (Murattal)', source: 'network', edition: 'ar.abdulbasitmurattal', sync: 'estimated' },
  { id: 'net-ar.husary', nameAr: 'محمود خليل الحصري', nameEn: 'Mahmoud Al-Husary', source: 'network', edition: 'ar.husary', sync: 'estimated' },
  { id: 'net-ar.minshawi', nameAr: 'محمد صديق المنشاوي', nameEn: 'Mohamed Al-Minshawi', source: 'network', edition: 'ar.minshawi', sync: 'estimated' },
  { id: 'net-ar.mahermuaiqly', nameAr: 'ماهر المعيقلي', nameEn: 'Maher Al-Muaiqly', source: 'network', edition: 'ar.mahermuaiqly', sync: 'estimated' },
  { id: 'net-ar.hudhaify', nameAr: 'علي بن عبدالرحمن الحذيفي', nameEn: 'Ali Al-Hudhaify', source: 'network', edition: 'ar.hudhaify', sync: 'estimated' },
  { id: 'net-ar.shaatree', nameAr: 'أبو بكر الشاطري', nameEn: 'Abu Bakr Ash-Shaatree', source: 'network', edition: 'ar.shaatree', sync: 'estimated' },
  { id: 'net-ar.ahmedajamy', nameAr: 'أحمد بن علي العجمي', nameEn: 'Ahmed Al-Ajamy', source: 'network', edition: 'ar.ahmedajamy', sync: 'estimated' },
  { id: 'net-ar.hanirifai', nameAr: 'هاني الرفاعي', nameEn: 'Hani Ar-Rifai', source: 'network', edition: 'ar.hanirifai', sync: 'estimated' },
]

export function networkAudioUrl(edition: string, surah: number): string {
  return `https://cdn.islamic.network/quran/audio-surah/128/${edition}/${surah}.mp3`
}

/** كلمات دالة لمطابقة اسم قارئ Quran.com مع طبعة islamic.network مكافئة */
const MATCHERS: Array<[string, string]> = [
  ['afasy', 'ar.alafasy'],
  ['alafasy', 'ar.alafasy'],
  ['afasy', 'ar.alafasy'],
  ['sudais', 'ar.abdurrahmaansudais'],
  ['sudais', 'ar.abdurrahmaansudais'],
  ['basit', 'ar.abdulbasitmurattal'],
  ['basit', 'ar.abdulbasitmurattal'],
  ['husary', 'ar.husary'],
  ['husari', 'ar.husary'],
  ['minshawi', 'ar.minshawi'],
  ['minsha', 'ar.minshawi'],
  ['muaiqly', 'ar.mahermuaiqly'],
  ['maher', 'ar.mahermuaiqly'],
  ['hudhaify', 'ar.hudhaify'],
  ['huthaify', 'ar.hudhaify'],
  ['shatri', 'ar.shaatree'],
  ['shatri', 'ar.shaatree'],
  ['ajamy', 'ar.ahmedajamy'],
  ['ajmi', 'ar.ahmedajamy'],
  ['rifai', 'ar.hanirifai'],
]

/** مطابقة تقريبية بالاسم اللاتيني — تُرجع edition إن وُجد مكافئ */
export function matchEditionByName(latinName: string): string | undefined {
  const n = latinName.toLowerCase()
  for (const [needle, edition] of MATCHERS) {
    if (n.includes(needle)) return edition
  }
  return undefined
}
