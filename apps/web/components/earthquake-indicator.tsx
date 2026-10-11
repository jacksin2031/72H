import React from 'react';
import type { Language } from '@/lib/contracts';

const labels = {
  ja: { title: '地震イベント', replay: '地震イベント（シミュレーション）', note: '拡散はイベントの図解です。震源位置・揺れの到達範囲を表しません。' },
  en: { title: 'Earthquake event', replay: 'Earthquake event (simulation)', note: 'The expanding rings illustrate an event, not its epicentre or shaking extent.' },
  'zh-TW': { title: '地震事件', replay: '地震事件（模擬）', note: '擴散動畫只作事件示意，不代表震央位置或震動影響範圍。' },
};

export function EarthquakeIndicator({ language, event, conserve }: {
  language: Language; event: { id: string; occurredAt: string; synthetic: boolean }; conserve: boolean;
}) {
  const t = labels[language];
  return <aside className={`earthquake-indicator${conserve ? ' is-static' : ''}`} aria-label={event.synthetic ? t.replay : t.title}>
    <span key={event.id} className="earthquake-ripple" aria-hidden="true"><i /><i /><i /><b /></span>
    <div><strong>{event.synthetic ? t.replay : t.title}</strong><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString(language, { timeZone: 'Asia/Tokyo' })}</time><p>{t.note}</p></div>
  </aside>;
}
