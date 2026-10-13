import { ar } from './ar.js';
import { en } from './en.js';
import type { Lang } from '../config/schema.js';

export type MessageKey = keyof typeof ar;
export type Vars = Record<string, string | number | undefined>;

const DICTS: Record<Lang, Record<MessageKey, string>> = { ar, en };

export function t(lang: Lang, key: MessageKey, vars: Vars = {}): string {
  const template = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}

export function isLang(v: unknown): v is Lang {
  return v === 'ar' || v === 'en';
}

export const SUPPORTED_LANGS: readonly Lang[] = ['ar', 'en'];
