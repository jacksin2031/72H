'use client';

import { useEffect, useRef, useState } from 'react';
import { inMapPack, mapCatalogSchema, verifyMapPack } from '@/lib/offline-map';
import type { Language } from '@/lib/contracts';

const mapText = {
  ja: {
    title: '東京都心の参考道路', note: '参考地図 · 現在地や震源地ではありません',
    caution: '浸水範囲・避難所・安全な経路は検証されていません。実際の移動判断に使用しないでください。',
    loading: '検証済みオフライン地図を読み込み中',
    unavailable: '検証済み道路地図を表示できません。未確認の地図に置き換えません。',
    ready: 'OpenStreetMap 道路データ · 参考のみ', zoomIn: '拡大', zoomOut: '縮小',
  },
  en: {
    title: 'Central Tokyo reference roads', note: 'Reference map · NOT your GPS or epicenter',
    caution: 'No verified hazard coverage, shelters or safe routes. Never use this map to authorize movement.',
    loading: 'Loading integrity-verified offline roads',
    unavailable: 'Verified map unavailable. No untrusted map substituted.',
    ready: 'OpenStreetMap roads · reference only', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
  },
  'zh-TW': {
    title: '東京都心參考道路', note: '參考地圖 · 並非你的定位或震央',
    caution: '沒有已核實的災區、避難所或安全路線；切勿用此地圖作移動決策。',
    loading: '正在載入已驗證的離線道路圖',
    unavailable: '無法顯示已驗證地圖，不會改用未經核實的圖層。',
    ready: 'OpenStreetMap 道路資料 · 僅供參考', zoomIn: '放大', zoomOut: '縮小',
  },
} as const;

/**
 * Geography-only simulation reference. Never render GPS, source hazards,
 * shelters, evacuation routes, movement authorizations or synthetic markers.
 * This is central-Tokyo OSM reference roads, not a historical 311 impact map.
 */
export function SimulationReferenceMap({ language, compact = false }: {
  language: Language; compact?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const t = mapText[language];

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    void (async () => {
      try {
        const catalogResponse = await fetch('/maps/catalog.json', { signal: controller.signal, cache: 'no-store' });
        if (!catalogResponse.ok) throw Error('Map catalog unavailable');
        const raw = await catalogResponse.text();
        if (raw.length > 32_000) throw Error('Map catalog exceeds budget');
        const catalog = mapCatalogSchema.parse(JSON.parse(raw));
        // Explicitly choose Tokyo road reference; never infer user GPS or 311 geography.
        const pack = catalog.packs.find(item => item.id === 'tokyo-central-v1');
        if (!pack || !inMapPack(139.75, 35.69, pack.bounds)) throw Error('Expected reference area unavailable');
        const fileResponse = await fetch(pack.asset, { signal: controller.signal });
        if (!fileResponse.ok) throw Error('Offline map unavailable');
        const roads = await verifyMapPack(pack, await fileResponse.arrayBuffer());
        const { Map, setWorkerCount, setWorkerUrl } = await import('maplibre-gl');
        if (cancelled || !host.current) return;
        setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
        setWorkerCount(1);
        const map = new Map({
          container: host.current,
          center: [139.75, 35.69], zoom: compact ? 10.9 : 12,
          minZoom: 10, maxZoom: 16, attributionControl: false,
          renderWorldCopies: false, fadeDuration: 0,
          maxBounds: [[pack.bounds[0],pack.bounds[1]],[pack.bounds[2],pack.bounds[3]]],
          style: {
            version: 8,
            sources: { streets: { type: 'geojson', data: roads } },
            layers: [
              { id:'land',type:'background',paint:{'background-color':'#17342f'} },
              { id:'roads-halo',type:'line',source:'streets',paint:{'line-color':'#162924','line-width':4,'line-opacity':0.75} },
              { id:'roads',type:'line',source:'streets',paint:{'line-color':'#83aba3','line-width':1.65,'line-opacity':0.92} },
            ],
          },
        });
        mapRef.current=map;
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => { if (!cancelled) map.resize(); });
          observer.observe(host.current);
        }
        map.scrollZoom.disable(); map.boxZoom.disable(); map.dragRotate.disable();
        map.touchZoomRotate.disable();
        map.once('load', () => { if (!cancelled) { map.resize(); setStatus('ready'); } });
        map.on('error', () => { if (!cancelled) setStatus('unavailable'); });
      } catch { if (!cancelled) setStatus('unavailable'); }
    })();
    return () => { cancelled=true; controller.abort(); observer?.disconnect(); mapRef.current?.remove(); mapRef.current=null; };
  }, [compact]);

  return <section className={compact ? 'sim-map-reference sim-map-compact' : 'sim-map-reference sim-map-full'}
    aria-label={t.title} data-testid="simulation-reference-map">
    <div ref={host} className="sim-map-canvas" aria-hidden="true"/>
    <div className="sim-map-maplabel"><strong>{t.title}</strong><small>{t.note}</small></div>
    {!compact && <div className="sim-map-controls">
      <button type="button" aria-label={t.zoomIn} onClick={() => mapRef.current?.zoomIn()} disabled={status!=='ready'}>+</button>
      <button type="button" aria-label={t.zoomOut} onClick={() => mapRef.current?.zoomOut()} disabled={status!=='ready'}>−</button>
    </div>}
    <p className="sim-map-status" role="status">
      {status==='loading' ? t.loading : status==='ready' ? t.ready : t.unavailable}
    </p>
    <p className="sim-map-caution">{t.caution}</p>
  </section>;
}
