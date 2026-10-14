import type { Language } from './contracts';
export const LANGUAGE_STORAGE_KEY = '72h-language';
export function readSavedLanguage(fallback: Language): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'ja' || saved === 'en' || saved === 'zh-TW') return saved;
  } catch { /* Storage can be blocked; the default language remains usable. */ }
  return fallback;
}

/** Query language takes precedence, matching Live. Invalid values fall back to the saved language. */
export function readPageLanguage(fallback: Language): Language {
  const query = new URLSearchParams(window.location.search).get('language');
  return query === 'ja' || query === 'en' || query === 'zh-TW' ? query : readSavedLanguage(fallback);
}
