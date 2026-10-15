'use client';
import { useEffect, useState } from 'react';
import type { Language } from '@/lib/contracts';
import { DRILL_PRESETS, drillPointToLocation, type DrillPoint, type HistoricalId } from '@/lib/drill-location';
import type { SimulationLocation } from '@/lib/simulation-advice';
import { Button, Section } from './ui';
import { SimulationReferenceMap } from './simulation-reference-map';

const text = {
  'zh-TW': { title: '演練位置', map: '在地圖上選點', here: '我的目前位置', use: '使用這個位置', cancel: '取消', change: '更改',
    suffix: '演練位置', hint: '點選地圖，再確認這個位置。', mapLabel: '地圖選點', hereLabel: '目前位置', busy: '正在解析所在地區…',
    geoFailed: '無法取得目前位置',
    OUTSIDE: '此位置不在日本的市區町村範圍內', UNAVAILABLE: '無法判斷此位置所屬的市區町村', AMBIGUOUS: '無法判斷此位置所屬的市區町村' }, 'zh-CN': { title: '演练位置', map: '在地图上选点', here: '我的目前位置', use: '使用这个位置', cancel: '取消', change: '更改',
    suffix: '演练位置', hint: '点击地图，再确认这个位置。', mapLabel: '地图选点', hereLabel: '目前位置', busy: '正在解析所在地区…',
    geoFailed: '无法取得目前位置',
    OUTSIDE: '此位置不在日本的市区町村范围内', UNAVAILABLE: '无法判断此位置所属的市区町村', AMBIGUOUS: '无法判断此位置所属的市区町村' },
  ja: { title: '演習位置', map: '地図で選ぶ', here: '現在地', use: 'この位置を使う', cancel: 'キャンセル', change: '変更',
    suffix: '演習位置', hint: '地図をタップして位置を確認します。', mapLabel: '地図で選択', hereLabel: '現在地', busy: '地域を解析中…',
    geoFailed: '現在地を取得できません',
    OUTSIDE: 'この位置は日本の市区町村の範囲外です', UNAVAILABLE: 'この位置の市区町村を判定できません', AMBIGUOUS: 'この位置の市区町村を判定できません' },
  en: { title: 'Drill location', map: 'Pick on map', here: 'My current location', use: 'Use this location', cancel: 'Cancel', change: 'Change',
    suffix: 'drill location', hint: 'Tap the map, then confirm the point.', mapLabel: 'Map pick', hereLabel: 'Current location', busy: 'Resolving area…',
    geoFailed: 'Could not get the current location',
    OUTSIDE: 'This point is outside Japan municipalities', UNAVAILABLE: 'Could not determine the municipality for this point', AMBIGUOUS: 'Could not determine the municipality for this point' },
} as const;

type Fix = { lat: number; lng: number; accuracy_m?: number };
const readOnce = (): Promise<Fix> => new Promise((resolve, reject) => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('unsupported')); return; }
  navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy }), reject, { maximumAge: 0, timeout: 15000 });
});

/** Exercise-only point chooser. Holds nothing in localStorage or IndexedDB; the chosen point lives in the caller's memory. */
export function DrillLocationPicker({ language, caseId, value, onChange, geolocate = readOnce, onMapOpenChange }: {
  language: Language; caseId: HistoricalId | null; value: DrillPoint | null;
  onChange: (point: DrillPoint | null, location: SimulationLocation | null, areaLabel: string) => void;
  geolocate?: () => Promise<Fix>; onMapOpenChange?: (open: boolean) => void;
}) {
  const t = text[language];
  const [mapOpen, setMapOpen] = useState(false);
  const [pending, setPending] = useState<Fix | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const presets = (caseId ? DRILL_PRESETS[caseId] : undefined) ?? [];
  useEffect(() => { onMapOpenChange?.(mapOpen); return () => { if (mapOpen) onMapOpenChange?.(false); }; }, [mapOpen, onMapOpenChange]);

  const choose = async (point: DrillPoint) => {
    setBusy(true); setMessage('');
    try {
      const result = await drillPointToLocation(point);
      if (result.ok) { setMapOpen(false); setPending(null); onChange(point, result.location, result.areaLabel); }
      else setMessage(t[result.reason]);
    } catch { setMessage(t.UNAVAILABLE); }
    finally { setBusy(false); }
  };
  const here = async () => {
    setBusy(true); setMessage('');
    let fix: Fix;
    try { fix = await geolocate(); } catch { setMessage(t.geoFailed); setBusy(false); return; }
    setBusy(false);
    const label = { ja: text.ja.hereLabel, 'zh-TW': text['zh-TW'].hereLabel, 'zh-CN': text['zh-CN'].hereLabel, en: text.en.hereLabel };
    await choose({ lat: fix.lat, lng: fix.lng, source: 'DEVICE_ONCE', label, preset_id: null, accuracy_m: fix.accuracy_m });
  };

  if (value) {
    return <Section title={t.title}>
      <p data-testid="drill-location-summary">{value.label[language]} · {t.suffix}</p>
      <Button variant="secondary" onClick={() => { setMessage(''); onChange(null, null, ''); }}>{t.change}</Button>
    </Section>;
  }
  return <Section title={t.title}>
    {!mapOpen && <>
      {presets.length > 0 && <div className="distress-tags">{presets.map(p =>
        <button type="button" className="ui-chip" key={p.id} disabled={busy}
          onClick={() => void choose({ lat: p.lat, lng: p.lng, source: 'PRESET', preset_id: p.id, label: p.label })}>{p.label[language]}</button>)}</div>}
      <Button variant="secondary" disabled={busy} onClick={() => { setMessage(''); setMapOpen(true); }}>{t.map}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void here()}>{t.here}</Button>
    </>}
    {mapOpen && <>
      <p className="now-meta">{t.hint}</p>
      <div className="drill-map">
        <SimulationReferenceMap language={language} compact legend="none" referencePoint={pending} onReferencePoint={setPending}
          focusPoint={presets[0] ? { lat: presets[0].lat, lng: presets[0].lng, zoom: 8 } : null} />
      </div>
      <Button variant="primary" disabled={!pending || busy} onClick={() => {
        if (pending) void choose({ lat: pending.lat, lng: pending.lng, source: 'MAP_PICK', preset_id: null,
          label: { ja: text.ja.mapLabel, 'zh-TW': text['zh-TW'].mapLabel, 'zh-CN': text['zh-CN'].mapLabel, en: text.en.mapLabel } });
      }}>{t.use}</Button>
      <Button variant="secondary" onClick={() => { setMapOpen(false); setPending(null); setMessage(''); }}>{t.cancel}</Button>
    </>}
    {busy && <p role="status" className="now-meta">{t.busy}</p>}
    {message && <p role="alert">{message}</p>}
  </Section>;
}
