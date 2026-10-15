'use client';

import { useEffect, useRef, useState } from 'react';
import type { Language, RoutePresentation, Snapshot } from '@/lib/contracts';
import { shouldShowDeviceMapMarker } from '@/lib/location-freshness';
import { inMapPack, locationCoordinates, mapCatalogSchema, selectMapPack, verifyMapPack, type MapManifest } from '@/lib/offline-map';
import type { DeviceLocation } from '@/lib/use-device-location';
import { vnextMessages } from '@/lib/vnext-i18n';
import { EarthquakeIndicator } from './earthquake-indicator';
import { mapGeographyManifestSchema, verifyMapGeography, type MapGeographyManifest } from '@/lib/map-geography';
import './simulation-map-ui.css';

export function EmergencyMap({ language, conserve, profile, location, locationResolving = false, onHomeMapReady, route, routeDestination, routeOrigin, originRef, earthquake }: {
  language: Language; conserve: boolean; profile?: Snapshot['profile']; location: DeviceLocation; locationResolving?: boolean; route?: RoutePresentation | null;
  onHomeMapReady?: (ready: boolean) => void;
  routeOrigin?: { label: string; lng: number; lat: number } | null;
  routeDestination?: { id: string; name: string; lng: number; lat: number } | null; originRef?: string;
  earthquake?: { id: string; occurredAt: string; synthetic: boolean } | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<import('maplibre-gl').Map | null>(null);
  const gpsMarker = useRef<import('maplibre-gl').Marker | null>(null);
  const resolveMarkerCollisions = useRef<() => void>(() => {});
  const fitMapExtent = useRef<() => void>(() => {});
  const [packs, setPacks] = useState<MapManifest[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [geographyManifest, setGeographyManifest] = useState<MapGeographyManifest | null>(null);
  const t = vnextMessages[language];
  const geographyLabels = language === 'ja' ? { land: '陸地', ocean: '海域', coast: '海岸線', unavailable: '陸地・海域のデータを利用できません。参考道路のみ表示しています。' }
    : language === 'zh-TW' ? { land: '陸地', ocean: '海洋', coast: '海岸線', unavailable: '陸海底圖未能載入，目前只顯示參考道路。' }
    : language === 'zh-CN' ? { land: '陆地', ocean: '海洋', coast: '海岸线', unavailable: '陆海底图未能加载，目前只显示参考道路。' }
      : { land: 'Land', ocean: 'Sea', coast: 'Coastline', unavailable: 'Land and sea data unavailable. Reference roads only.' };
  const origin = routeOrigin ? [routeOrigin.lng, routeOrigin.lat] as [number, number] : locationCoordinates(profile?.current_location);
  const device = location.position ? [location.position.longitude, location.position.latitude] as [number, number] : null;
  const deviceFreshnessLabel = location.freshness === 'CURRENT' ? t.locationStates.live
    : location.freshness === 'AGING' ? t.locationStates.aging
      : location.freshness === 'STALE' ? t.locationStates.stale
        : location.freshness === 'LAST_KNOWN' ? t.locationStates.last : t.locationStates.unavailable;
  const deviceCapturedAt = location.position
    ? new Date(location.position.captured_at).toLocaleString(language, { timeZone: 'Asia/Tokyo' }) : null;
  const routeDestinationMatches = !!route && !!routeDestination && route.destination_id === routeDestination.id;
  const routeCoordinates = routeDestinationMatches && ['PROVIDER_GEOMETRY', 'TRANSIT_STATION_SEQUENCE'].includes(route?.geometry_kind ?? '')
    ? route?.geometry?.coordinates : undefined;
  // projectLiveSnapshot creates a new route presentation object on each render. Track only
  // the route semantics that affect the map so a GPS state update cannot rebuild the map.
  const routeMapIdentity = JSON.stringify([route?.id ?? null, route?.destination_id ?? null,
    route?.geometry_kind ?? null, routeCoordinates ?? null, routeDestinationMatches]);
  const routePresent = !!route;
  const routeLineCoordinates = route?.geometry_kind === 'PROVIDER_GEOMETRY' ? routeCoordinates : undefined;
  const routePack = packs && routeCoordinates?.length
    ? packs.find(pack => routeCoordinates.every(([lng, lat]) => inMapPack(lng, lat, pack.bounds))) ?? null : null;
  const approved = packs && (routeCoordinates?.length ? routePack : selectMapPack(packs, origin ?? device));
  const originLng = origin?.[0], originLat = origin?.[1];
  const destinationLocation = !route ? profile?.current_destination ?? profile?.accommodation_location : null;
  const destination = routeDestinationMatches && routeDestination ? [routeDestination.lng, routeDestination.lat] as [number, number] : locationCoordinates(destinationLocation);
  const destinationLng = destination?.[0], destinationLat = destination?.[1];
  const originLabel = routeOrigin?.label ?? originRef ?? profile?.current_location.label;
  const destinationLabel = routeDestination?.name ?? destinationLocation?.label;

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/maps/catalog.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Map catalog unavailable');
      const raw = await response.text();
      if (raw.length > 32_000) throw new Error('Map catalog oversized');
      const catalog = mapCatalogSchema.parse(JSON.parse(raw));
      if (!controller.signal.aborted) setPacks(catalog.packs);
    }).catch(() => { if (!controller.signal.aborted) setCatalogFailed(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!approved) return;
    let cancelled = false;
    const controller = new AbortController();
    setState('loading');
    setGeographyManifest(null);
    void (async () => {
      try {
        const response = await fetch(approved.asset, { signal: controller.signal });
        if (!response.ok) throw new Error('Map unavailable');
        const data = await verifyMapPack(approved, await response.arrayBuffer());
        // Optional local geography is tied to this pack's exact extent and independently verified.
        // If unavailable, keep a neutral road-only surface instead of inventing land or sea.
        let geography: Awaited<ReturnType<typeof verifyMapGeography>> | null = null;
        let manifest: MapGeographyManifest | null = null;
        try {
          const geoSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
          const metadata = await fetch('/maps/geography-manifest.json', { signal: geoSignal });
          if (!metadata.ok) throw new Error('Geography metadata unavailable');
          const raw = await metadata.text();
          if (raw.length > 32000) throw new Error('Geography metadata oversized');
          manifest = mapGeographyManifestSchema.parse(JSON.parse(raw));
          if (!manifest.bounds.every((value, index) => value === approved.bounds[index])) throw new Error('Geography extent mismatch');
          const asset = await fetch(manifest.asset, { signal: geoSignal });
          if (!asset.ok) throw new Error('Geography unavailable');
          geography = await verifyMapGeography(manifest, await asset.arrayBuffer());
        } catch { manifest = null; }
        const { Map, Marker, NavigationControl, setWorkerUrl, setWorkerCount } = await import('maplibre-gl');
        if (cancelled || !host.current) return;
        setGeographyManifest(manifest);
        setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'); setWorkerCount(1);
        const center: [number, number] = [(approved.bounds[0] + approved.bounds[2]) / 2, (approved.bounds[1] + approved.bounds[3]) / 2];
        const map = new Map({ container: host.current, center, zoom: 11, minZoom: 2, maxZoom: 16,
          attributionControl: false, fadeDuration: 0, renderWorldCopies: false,
          style: { version: 8, sources: {
            roads: { type: 'geojson', data },
            coverage: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
              [approved.bounds[0], approved.bounds[1]], [approved.bounds[2], approved.bounds[1]],
              [approved.bounds[2], approved.bounds[3]], [approved.bounds[0], approved.bounds[3]], [approved.bounds[0], approved.bounds[1]],
            ]] } } },
            outsideCoverage: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [
              // A local collar avoids antimeridian wrapping in GeoJSON tiling.
              [[approved.bounds[0] - 10, approved.bounds[1] - 10], [approved.bounds[2] + 10, approved.bounds[1] - 10],
                [approved.bounds[2] + 10, approved.bounds[3] + 10], [approved.bounds[0] - 10, approved.bounds[3] + 10], [approved.bounds[0] - 10, approved.bounds[1] - 10]],
              [[approved.bounds[0], approved.bounds[1]], [approved.bounds[0], approved.bounds[3]],
                [approved.bounds[2], approved.bounds[3]], [approved.bounds[2], approved.bounds[1]], [approved.bounds[0], approved.bounds[1]]],
            ] } } },
            ...(geography ? { geography: { type: 'geojson' as const, data: geography } } : {}),
            ...(routeLineCoordinates?.length && route?.geometry ? {
              verifiedRoute: { type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, properties: {}, geometry: route.geometry }] } },
            } : {}),
          }, layers: [
            { id: 'paper', type: 'background', paint: { 'background-color': '#161d25' } },
            { id: 'pack-surface', type: 'fill', source: 'coverage', paint: { 'fill-color': geography ? '#0b131e' : '#202b35' } },
            ...(geography ? [
              { id: 'land', type: 'fill' as const, source: 'geography', filter: ['==', 'kind', 'land'] as ['==', string, string], paint: { 'fill-color': '#29343f' } },
              { id: 'coastline-halo', type: 'line' as const, source: 'geography', filter: ['==', 'kind', 'coastline'] as ['==', string, string], paint: { 'line-color': '#0b131e', 'line-width': 5 } },
              { id: 'coastline', type: 'line' as const, source: 'geography', filter: ['==', 'kind', 'coastline'] as ['==', string, string], paint: { 'line-color': '#a3b6c7', 'line-width': 1.8 } },
            ] : []),
            { id: 'roads', type: 'line', source: 'roads', paint: { 'line-color': '#586775', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 2], 'line-opacity': 0.65 } },
            { id: 'outside-pack', type: 'fill', source: 'outsideCoverage', paint: { 'fill-color': '#161d25' } },
            { id: 'pack-boundary', type: 'line', source: 'coverage', paint: { 'line-color': '#647789', 'line-width': 1, 'line-dasharray': [3, 3] } },
            ...(routeLineCoordinates?.length && route?.geometry ? [{
              id: 'verified-route-line', type: 'line' as const, source: 'verifiedRoute',
              paint: { 'line-color': '#d0ad76', 'line-width': 4, 'line-opacity': 0.95 },
            }] : []),
          ] },
        });
        instance.current = map;
        map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        const pin = (label: string | undefined, kind: string, referenceLabel: string, lng: number | undefined, lat: number | undefined) => {
          if (!label || lng === undefined || lat === undefined || !inMapPack(lng, lat, approved.bounds)) return;
          const element = document.createElement('div'); element.className = 'map-pin ' + kind;
          element.title = `${referenceLabel}: ${label}`; element.tabIndex = 0;
          element.setAttribute('role', 'img'); element.setAttribute('aria-label', `${referenceLabel}: ${label}`);
          new Marker({ element }).setLngLat([lng, lat]).addTo(map);
        };
        pin(originLabel, 'origin', t.profileReference, originLng, originLat);
        pin(destinationLabel, 'destination', routeDestinationMatches ? t.designatedDestination : t.profileReference, destinationLng, destinationLat);
        // Road geometry already has a line. Repeating numbered pins obscures it.
        // Station sequences retain intermediate reference points, without duplicating endpoints.
        if (route?.geometry_kind === 'TRANSIT_STATION_SEQUENCE' && routeCoordinates?.length) {
          const step = Math.max(1, Math.ceil(routeCoordinates.length / 16));
          const indices = new Set<number>();
          for (let index = step; index < routeCoordinates.length - 1; index += step) indices.add(index);
          for (const index of indices) {
            const point = routeCoordinates[index];
            const element = document.createElement('div'); element.className = 'map-route-point';
            element.textContent = String(index + 1); element.setAttribute('role', 'img');
            element.setAttribute('aria-label', `${t.coordinatePoint} ${index + 1}`);
            element.title = `${t.coordinatePoint} ${index + 1}`;
            new Marker({ element }).setLngLat(point).addTo(map);
          }
        }
        const fitExtent = () => {
          if (routeCoordinates?.length) {
            const xs = routeCoordinates.map(point => point[0]), ys = routeCoordinates.map(point => point[1]);
            map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 40, animate: false, maxZoom: 13 });
          } else map.fitBounds([[approved.bounds[0], approved.bounds[1]], [approved.bounds[2], approved.bounds[3]]], { padding: 24, animate: false });
        };
        fitMapExtent.current = fitExtent;
        map.once('load', () => { if (!cancelled) {
          fitExtent();
          setState('ready');
        } });
        map.on('error', () => { if (!cancelled) setState('unavailable'); });
      } catch { if (!cancelled) setState('unavailable'); }
    })();
    return () => { cancelled = true; controller.abort(); gpsMarker.current = null; fitMapExtent.current = () => {}; instance.current?.remove(); instance.current = null; };
  }, [approved, originLng, originLat, destinationLng, destinationLat, originLabel, destinationLabel, t.profileReference, t.designatedDestination, t.coordinatePoint, routeMapIdentity]);

  useEffect(() => { if (instance.current) { instance.current.scrollZoom.disable(); instance.current.dragRotate.disable(); instance.current.touchZoomRotate.disableRotation(); } }, [state, conserve]);
  useEffect(() => {
    const map = instance.current, container = host.current;
    if (state !== 'ready' || !map || !container) return;
    const settleMarkers = () => {
      const priority = (element: HTMLElement) => element.classList.contains('device') ? 0 : element.classList.contains('origin') ? 1 : element.classList.contains('destination') ? 2 : 3;
      const markers = [...container.querySelectorAll<HTMLElement>('.map-pin,.map-route-point')].sort((a, b) => priority(a) - priority(b));
      const controls = [...container.querySelectorAll<HTMLElement>('.maplibregl-ctrl-group')].map(element => element.getBoundingClientRect());
      const occupied: { x: number; y: number }[] = [];
      for (const element of markers) {
        const rect = element.getBoundingClientRect(), point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        const overlaps = occupied.some(other => Math.hypot(point.x - other.x, point.y - other.y) < 28)
          || controls.some(control => rect.right + 8 > control.left && rect.left - 8 < control.right && rect.bottom + 8 > control.top && rect.top - 8 < control.bottom);
        element.style.visibility = overlaps ? 'hidden' : '';
        element.setAttribute('aria-hidden', String(overlaps));
        element.tabIndex = overlaps ? -1 : 0;
        if (!overlaps) occupied.push(point);
      }
    };
    resolveMarkerCollisions.current = settleMarkers;
    // Reflow the canvas with its container; geographic anchors themselves never move.
    const resize = () => { map.resize(); fitMapExtent.current(); settleMarkers(); };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(container);
    map.on('moveend', settleMarkers); map.on('resize', settleMarkers); settleMarkers();
    return () => { observer?.disconnect(); map.off('moveend', settleMarkers); map.off('resize', settleMarkers); resolveMarkerCollisions.current = () => {}; };
  }, [state]);
  useEffect(() => {
    let cancelled = false;
    gpsMarker.current?.remove(); gpsMarker.current = null;
    const point = location.position;
    if (locationResolving || routePresent || state !== 'ready' || !approved || !point || !shouldShowDeviceMapMarker(location.freshness)
      || !inMapPack(point.longitude, point.latitude, approved.bounds)) return;
    void import('maplibre-gl').then(({ Marker }) => {
      if (cancelled || !instance.current) return;
      const element = document.createElement('div');
      element.className = 'map-pin device'; element.tabIndex = 0;
      const accessibleLabel = `${t.deviceLocation}: ${t.locationStates.live} · ${t.locationCapturedAt}: ${deviceCapturedAt ?? ''}`;
      element.setAttribute('role', 'img'); element.setAttribute('aria-label', accessibleLabel); element.title = accessibleLabel;
      gpsMarker.current = new Marker({ element }).setLngLat([point.longitude, point.latitude]).addTo(instance.current);
      resolveMarkerCollisions.current();
    });
    return () => { cancelled = true; gpsMarker.current?.remove(); gpsMarker.current = null; };
  }, [location.position, location.freshness, locationResolving, state, approved, routePresent, t.deviceLocation, t.locationStates.live, deviceCapturedAt, t.locationCapturedAt]);

  const availableState = catalogFailed ? 'unavailable' : packs && !approved ? 'unsupported' : state;
  useEffect(() => {
    if (!onHomeMapReady) return;
    onHomeMapReady(availableState === 'ready');
    return () => onHomeMapReady(false);
  }, [availableState, onHomeMapReady]);
  return <section className="map-section" aria-label={t.map}>
    <div className="map-meta"><strong>{t.map}</strong><span className="badge">{availableState === 'ready' ? t.mapReady : availableState === 'loading' ? t.mapLoading : availableState === 'unsupported' ? t.mapUnsupported : t.mapUnavailable}</span></div>
    {earthquake && <EarthquakeIndicator language={language} event={earthquake} conserve={conserve} />}
    <div className="emergency-map" ref={host} role="img" aria-label={t.mapDescription} />
    {geographyManifest && <div className="map-legend"><span><i className="map-swatch land" aria-hidden="true" />{geographyLabels.land}</span><span><i className="map-swatch ocean" aria-hidden="true" />{geographyLabels.ocean}</span><span><i className="map-swatch coast" aria-hidden="true" />{geographyLabels.coast}</span></div>}
    {availableState === 'ready' && !geographyManifest && <p role="status">{geographyLabels.unavailable}</p>}
    {availableState !== 'ready' && availableState !== 'loading' && <p role="status">{availableState === 'unsupported' ? t.mapUnsupported : t.mapFallback}</p>}
    {(profile || route) && <ul className="map-reference-list"><li><i className="map-swatch" aria-hidden="true" /><span>{t.profileReference}: {originLabel || '—'}{originLng === undefined ? ` · ${t.coordinatesUnavailable}` : ''}</span></li>
      {destinationLabel && <li><i className="map-swatch destination" aria-hidden="true" /><span>{route ? t.designatedDestination : t.profileReference}: {destinationLabel}{destinationLng === undefined ? ` · ${t.coordinatesUnavailable}` : ''}</span></li>}</ul>}
    {location.position && <p className="device-location-map-status" data-location-freshness={location.freshness}>
      {t.deviceLocation}: {deviceFreshnessLabel} · {t.locationCapturedAt}: {deviceCapturedAt} · ±{Math.round(location.position.accuracy_m)} m
    </p>}
    {approved && routeDestinationMatches && destination && !inMapPack(destination[0], destination[1], approved.bounds) && <p role="status">{t.locationStates.outside}</p>}
    {approved && location.position && !inMapPack(location.position.longitude, location.position.latitude, approved.bounds) && <p role="status">{t.locationStates.outside}</p>}
    <p className="muted">{t.mapLimit}</p>
    {approved && <><p className="muted">{approved.id} · {t.mapCaptured}: {new Date(approved.captured_at).toLocaleDateString(language)} · {(approved.bytes / 1_000_000).toFixed(2)} MB · {approved.license}</p>
      <a className="map-attribution" href={approved.source_url} target="_blank" rel="noreferrer">© {approved.source}</a> · <a className="map-attribution" href={approved.asset} download>ODbL data</a></>}
    {geographyManifest && <p className="muted"><a href={geographyManifest.source_url} target="_blank" rel="noreferrer">{geographyManifest.attribution}</a> · <a href={geographyManifest.license_url} target="_blank" rel="noreferrer">{geographyManifest.license}</a></p>}
  </section>;
}
