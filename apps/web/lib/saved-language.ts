import type { Language } from './contracts';
export const LANGUAGE_STORAGE_KEY = '72h-language';
export function readSavedLanguage(fallback: Language): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'ja' || saved === 'en' || saved === 'zh-TW') return saved;
  } catch { /* Storage can be blocked; the default language remains usable. */ }
  return fallback;
}
