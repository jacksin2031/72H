'use client';

import { useEffect, useRef, useState } from 'react';
import type { Language, RoutePresentation, Snapshot } from '@/lib/contracts';
import { inMapPack, locationCoordinates, mapCatalogSchema, selectMapPack, verifyMapPack, type MapManifest } from '@/lib/offline-map';
import type { DeviceLocation } from '@/lib/use-device-location';
import { vnextMessages } from '@/lib/vnext-i18n';

export function EmergencyMap({ language, conserve, profile, location, route, routeDestination, routeOrigin, originRef }: {
  language: Language; conserve: boolean; profile?: Snapshot['profile']; location: DeviceLocation; route?: RoutePresentation | null;
  routeOrigin?: { label: string; lng: number; lat: number } | null;
  routeDestination?: { id: string; name: string; lng: number; lat: number } | null; originRef?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<import('maplibre-gl').Map | null>(null);
  const gpsMarker = useRef<import('maplibre-gl').Marker | null>(null);
  const [packs, setPacks] = useState<MapManifest[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const t = vnextMessages[language];
  const origin = routeOrigin ? [routeOrigin.lng, routeOrigin.lat] as [number, number] : locationCoordinates(profile?.current_location);
  const device = location.position ? [location.position.longitude, location.position.latitude] as [number, number] : null;
  const routeDestinationMatches = !!route && !!routeDestination && route.destination_id === routeDestination.id;
  const routeCoordinates = routeDestinationMatches && ['PROVIDER_GEOMETRY', 'TRANSIT_STATION_SEQUENCE'].includes(route?.geometry_kind ?? '')
    ? route?.geometry?.coordinates : undefined;
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
    void (async () => {
      try {
        const response = await fetch(approved.asset, { signal: controller.signal });
        if (!response.ok) throw new Error('Map unavailable');
        const data = await verifyMapPack(approved, await response.arrayBuffer());
        const { Map, Marker, NavigationControl, setWorkerUrl, setWorkerCount } = await import('maplibre-gl');
        if (cancelled || !host.current) return;
        setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'); setWorkerCount(1);
        const center: [number, number] = [(approved.bounds[0] + approved.bounds[2]) / 2, (approved.bounds[1] + approved.bounds[3]) / 2];
        const map = new Map({ container: host.current, center, zoom: 11, minZoom: 2, maxZoom: 16,
          maxBounds: [[approved.bounds[0], approved.bounds[1]], [approved.bounds[2], approved.bounds[3]]],
          attributionControl: false, fadeDuration: 0, renderWorldCopies: false,
          style: { version: 8, sources: {
            roads: { type: 'geojson', data },
            ...(routeLineCoordinates?.length && route?.geometry ? {
              verifiedRoute: { type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, properties: {}, geometry: route.geometry }] } },
            } : {}),
          }, layers: [
            { id: 'paper', type: 'background', paint: { 'background-color': '#101a18' } },
            { id: 'roads', type: 'line', source: 'roads', paint: { 'line-color': '#7a9c91', 'line-width': 2 } },
            ...(routeLineCoordinates?.length && route?.geometry ? [{
              id: 'verified-route-line', type: 'line' as const, source: 'verifiedRoute',
              paint: { 'line-color': '#f1c36b', 'line-width': 4, 'line-opacity': 0.95 },
            }] : []),
          ] },
        });
        instance.current = map;
        map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        const pin = (label: string | undefined, kind: string, referenceLabel: string, lng: number | undefined, lat: number | undefined) => {
          if (!label || lng === undefined || lat === undefined || !inMapPack(lng, lat, approved.bounds)) return;
          const element = document.createElement('div'); element.className = 'map-pin ' + kind; element.textContent = label + ' · ' + referenceLabel;
          element.setAttribute('role', 'img'); element.setAttribute('aria-label', `${referenceLabel}: ${label}`);
          new Marker({ element }).setLngLat([lng, lat]).addTo(map);
        };
        pin(originLabel, 'origin', t.profileReference, originLng, originLat);
        pin(destinationLabel, 'destination', routeDestinationMatches ? t.designatedDestination : t.profileReference, destinationLng, destinationLat);
        if (routeCoordinates?.length) {
          const step = Math.max(1, Math.ceil(routeCoordinates.length / 16));
          const indices = new Set([0, routeCoordinates.length - 1]);
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
        map.once('load', () => { if (!cancelled) {
          if (routeCoordinates?.length) {
            const xs = routeCoordinates.map(point => point[0]), ys = routeCoordinates.map(point => point[1]);
            map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 40, animate: false, maxZoom: 13 });
          } else map.fitBounds([[approved.bounds[0], approved.bounds[1]], [approved.bounds[2], approved.bounds[3]]], { padding: 24, animate: false });
          setState('ready');
        } });
        map.on('error', () => { if (!cancelled) setState('unavailable'); });
      } catch { if (!cancelled) setState('unavailable'); }
    })();
    return () => { cancelled = true; controller.abort(); gpsMarker.current = null; instance.current?.remove(); instance.current = null; };
  }, [approved, originLng, originLat, destinationLng, destinationLat, originLabel, destinationLabel, t.profileReference, t.designatedDestination, t.coordinatePoint, route, routeDestinationMatches]);

  useEffect(() => { if (instance.current) { instance.current.scrollZoom.disable(); instance.current.dragRotate.disable(); instance.current.touchZoomRotate.disableRotation(); } }, [state, conserve]);
  useEffect(() => {
    let cancelled = false;
    gpsMarker.current?.remove(); gpsMarker.current = null;
    const point = location.position;
    if (route || state !== 'ready' || !approved || !point || location.state === 'unavailable' || !inMapPack(point.longitude, point.latitude, approved.bounds)) return;
    void import('maplibre-gl').then(({ Marker }) => {
      if (cancelled || !instance.current) return;
      gpsMarker.current = new Marker({ color: location.state === 'live' ? '#215fd1' : '#657568' }).setLngLat([point.longitude, point.latitude]).addTo(instance.current);
    });
    return () => { cancelled = true; gpsMarker.current?.remove(); gpsMarker.current = null; };
  }, [location.position, location.state, state, approved, route]);

  const availableState = catalogFailed ? 'unavailable' : packs && !approved ? 'unsupported' : state;
  return <section className="map-section" aria-label={t.map}>
    <div className="map-meta"><strong>{t.map}</strong><span className="badge">{availableState === 'ready' ? t.mapReady : availableState === 'loading' ? t.mapLoading : availableState === 'unsupported' ? t.mapUnsupported : t.mapUnavailable}</span></div>
    <div className="emergency-map" ref={host} role="img" aria-label={t.mapDescription} />
    {availableState !== 'ready' && availableState !== 'loading' && <p role="status">{availableState === 'unsupported' ? t.mapUnsupported : t.mapFallback}</p>}
    {(profile || route) && <><p>{t.profileReference}: {originLabel || '—'}{originLng === undefined ? ` · ${t.coordinatesUnavailable}` : ''}</p>
      {route && <p>{t.designatedDestination}: {routeDestinationMatches ? routeDestination.name : '—'}{destinationLng === undefined ? ` · ${t.coordinatesUnavailable}` : ''}</p>}</>}
    {approved && routeDestinationMatches && destination && !inMapPack(destination[0], destination[1], approved.bounds) && <p role="status">{t.locationStates.outside}</p>}
    {approved && location.position && !inMapPack(location.position.longitude, location.position.latitude, approved.bounds) && <p role="status">{t.locationStates.outside}</p>}
    <p className="muted">{t.mapLimit}</p>
    {approved && <><p className="muted">{approved.id} · {t.mapCaptured}: {new Date(approved.captured_at).toLocaleDateString(language)} · {(approved.bytes / 1_000_000).toFixed(2)} MB · {approved.license}</p>
      <a className="map-attribution" href={approved.source_url} target="_blank" rel="noreferrer">© {approved.source}</a> · <a className="map-attribution" href={approved.asset} download>ODbL data</a></>}
  </section>;
}
