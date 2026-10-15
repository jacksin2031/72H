// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { messages } from '../lib/i18n';
import { vnextMessages } from '../lib/vnext-i18n';
import { liveMessages } from '../lib/live-i18n';
import { adaptiveMessages } from '../lib/adaptive-i18n';
import { liveMoreMessages } from '../lib/live-more-i18n';
import { tagText, sosText, distressText, emphasisText } from '../lib/distress';
import { explanationText } from '../lib/plan-explanation';
import { simulationAdviceText } from '../lib/simulation-advice';
import { APP_TABS } from '../lib/app-tabs';
import { readPageLanguage, readSavedLanguage, LANGUAGE_STORAGE_KEY } from '../lib/saved-language';
import { speechLang } from '../lib/distress-guidance';

// Characters that only appear in Traditional wording; none may leak into zh-CN tables.
const TRADITIONAL_ONLY = /[驗證資訊與請這為們點線開關確認處檢議難災協據層區後]/;
const tables = { messages, vnextMessages, liveMessages, adaptiveMessages, liveMoreMessages, tagText, sosText, distressText, emphasisText, explanationText, simulationAdviceText };

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

afterEach(() => { localStorage.clear(); history.replaceState({}, '', '/'); });

describe('Simplified Chinese (zh-CN)', () => {
  it.each(Object.entries(tables))('%s has a zh-CN table with the same keys as zh-TW', (_name, table) => {
    const t = table as Record<string, Record<string, unknown>>;
    expect(t['zh-CN']).toBeDefined();
    expect(Object.keys(t['zh-CN']).sort()).toEqual(Object.keys(t['zh-TW']).sort());
  });

  it.each(Object.entries(tables))('%s zh-CN wording uses Simplified characters', (_name, table) => {
    const leaked = strings((table as Record<string, unknown>)['zh-CN']).filter(s => TRADITIONAL_ONLY.test(s));
    expect(leaked).toEqual([]);
  });

  it('labels navigation tabs in Simplified Chinese', () => {
    expect(APP_TABS.map(tab => tab.label['zh-CN'])).toEqual(['现在', '地图', '更多']);
  });

  it('restores zh-CN from storage and from the language query', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'zh-CN');
    expect(readSavedLanguage('ja')).toBe('zh-CN');
    localStorage.clear();
    history.replaceState({}, '', '/?language=zh-CN');
    expect(readPageLanguage('ja')).toBe('zh-CN');
  });

  it('speaks zh-CN guidance with a mainland voice', () => {
    expect(speechLang('zh-CN')).toBe('zh-CN');
    expect(speechLang('zh-TW')).toBe('zh-TW');
  });
});
