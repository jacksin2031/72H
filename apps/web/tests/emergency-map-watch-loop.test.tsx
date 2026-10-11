// @vitest-environment jsdom
import React, { useEffect, useRef, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmergencyMap } from '../components/emergency-map';
import type { RoutePresentation } from '../lib/contracts';
import type { DeviceLocation } from '../lib/use-device-location';

const mapHarness = vi.hoisted(() => ({
  mapCreations: 0,
  mapRemovals: 0,
  watchRegistrations: 0,
  clearedWatchIds: [] as number[],
  pack: {
    id: 'test-map', asset: '/maps/test.bin', sha256: 'test-hash', bytes: 12,
    bounds: [139, 35, 141, 37], captured_at: '2026-10-08T00:00:00Z',
    source: 'test source', source_url: 'https://example.test/map', license: 'ODbL',
  },
}));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    scrollZoom = { disable() {} };
    dragRotate = { disable() {} };
    touchZoomRotate = { disableRotation() {} };
    constructor() { mapHarness.mapCreations += 1; }
    addControl() { return this; }
    once(event: string, callback: () => void) {
      if (event === 'load') queueMicrotask(callback);
      return this;
    }
    on() { return this; }
    off() { return this; }
    resize() { return this; }
    fitBounds() { return this; }
    remove() { mapHarness.mapRemovals += 1; }
  }
  class FakeMarker {
    setLngLat() { return this; }
    addTo() { return this; }
    remove() { return this; }
  }
  return { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, setWorkerUrl() {}, setWorkerCount() {} };
});

vi.mock('@/lib/offline-map', () => ({
  inMapPack: () => true,
  locationCoordinates: () => null,
  mapCatalogSchema: { parse: () => ({ packs: [mapHarness.pack] }) },
  selectMapPack: () => mapHarness.pack,
  verifyMapPack: async () => ({ type: 'FeatureCollection', features: [] }),
}));

const routeBase = {
  id: 'route-1', status: 'VERIFIED_USABLE',
  geometry: { type: 'LineString', coordinates: [[139.7, 35.7], [139.8, 35.8]] },
  geometry_kind: 'PROVIDER_GEOMETRY', presentation_label: 'Verified route', waypoints: [], crs: 'EPSG:4326',
  origin_area_id: 'JP-MUNI-13104', destination_id: 'shelter-1', provider: 'fixture', provider_reference: 'route-ref',
  checked_at: '2026-10-08T01:00:00Z', expires_at: '2026-10-08T02:00:00Z', evidence_ids: [],
  freshness_status: 'CURRENT', conflict: false,
} as RoutePresentation;

function HomeMapWithControlledWatch() {
  const [mapReady, setMapReady] = useState(false);
  const [position, setPosition] = useState<DeviceLocation['position']>(null);
  const renderCount = useRef(0);
  renderCount.current += 1;

  // projectLiveSnapshot returns a fresh presentation object on every parent render.
  // Clone the nested geometry too, while preserving its map meaning.
  const route = {
    ...routeBase,
    geometry: routeBase.geometry ? {
      ...routeBase.geometry,
      coordinates: routeBase.geometry.coordinates.map(([lng, lat]) => [lng, lat] as [number, number]),
    } : null,
  };
  const location = {
    position, consent: false, ready: true, busy: false, failed: false, permissionDenied: false,
    permissionGranted: true, storageUnavailable: false, state: position ? 'live' : 'unavailable',
    freshness: position ? 'CURRENT' : 'UNAVAILABLE', now: Date.now(), retain() {}, locate: async () => null,
  } as DeviceLocation;

  useEffect(() => {
    if (!mapReady) return;
    const geolocation = navigator.geolocation;
    const id = geolocation.watchPosition(fix => {
      setPosition({ latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy_m: fix.coords.accuracy,
        captured_at: fix.timestamp, source: 'BROWSER_GEOLOCATION' });
    });
    return () => geolocation.clearWatch(id);
  }, [mapReady]);

  return <>
    <output data-testid="home-renders">{renderCount.current}</output>
    <output data-testid="latest-fix">{position?.captured_at ?? ''}</output>
    <EmergencyMap language="en" conserve={false} location={location} route={route}
      routeDestination={{ id: 'shelter-1', name: 'Test shelter', lng: 139.8, lat: 35.8 }} onHomeMapReady={setMapReady} />
  </>;
}

describe('EmergencyMap authorized Home watch stability', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let originalGeolocation: PropertyDescriptor | undefined;

  beforeEach(() => {
    mapHarness.mapCreations = 0;
    mapHarness.mapRemovals = 0;
    mapHarness.watchRegistrations = 0;
    mapHarness.clearedWatchIds = [];
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(success: PositionCallback) {
        const id = ++mapHarness.watchRegistrations;
        // Emit a newer fix on every registration to expose a map/watch reset loop.
        if (id <= 3) success({ coords: { latitude: 35.7, longitude: 139.7, accuracy: 20, altitude: null, altitudeAccuracy: null,
          heading: null, speed: null }, timestamp: Date.now() + id } as GeolocationPosition);
        return id;
      },
      clearWatch(id: number) { mapHarness.clearedWatchIds.push(id); },
      getCurrentPosition() {},
    } });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '{"packs":[]}',
      arrayBuffer: async () => new ArrayBuffer(12),
    })));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (root) await act(async () => { root?.unmount(); });
    root = null;
    container.remove();
    if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation);
    else Reflect.deleteProperty(navigator, 'geolocation');
    vi.unstubAllGlobals();
  });

  it('keeps the ready map and authorized watch when a GPS fix creates a fresh equivalent route object', async () => {
    await act(async () => {
      root!.render(<HomeMapWithControlledWatch />);
      for (let attempt = 0; attempt < 8; attempt += 1) await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(Number(container.querySelector('[data-testid="home-renders"]')?.textContent)).toBeGreaterThan(1);
    expect(container.querySelector('[data-testid="latest-fix"]')?.textContent).not.toBe('');
    expect(mapHarness.mapCreations).toBe(1);
    expect(mapHarness.mapRemovals).toBe(0);
    expect(mapHarness.watchRegistrations).toBe(1);
    expect(mapHarness.clearedWatchIds).toEqual([]);
  });
});
