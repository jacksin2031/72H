import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmergencyMap } from '../components/emergency-map';
import type { DeviceLocation } from '../lib/use-device-location';
import { vnextMessages } from '../lib/vnext-i18n';

const point = { latitude: 35.69, longitude: 139.70, accuracy_m: 25, captured_at: Date.parse('2026-10-08T01:02:03.000Z'), source: 'BROWSER_GEOLOCATION' as const };

describe.each([
  ['LAST_KNOWN', 'last'],
  ['AGING', 'aging'],
  ['STALE', 'stale'],
] as const)('map location disclosure for %s', (freshness, messageKey) => {
  it('discloses that the point is not current and when it was captured', () => {
    const location = {
      position: point, consent: true, ready: true, busy: false, failed: false, permissionDenied: false, permissionGranted: false,
      storageUnavailable: false, state: freshness === 'LAST_KNOWN' ? 'last' : freshness.toLowerCase(), freshness,
      now: Date.parse('2026-10-08T01:03:03.000Z'), retain: () => {}, locate: async () => null,
    } as unknown as DeviceLocation;
    const html = renderToStaticMarkup(<EmergencyMap language="en" conserve={false} location={location} />);
    expect(html).toContain(`data-location-freshness="${freshness}"`);
    expect(html).toContain(vnextMessages.en.locationStates[messageKey]);
    expect(html).toContain(vnextMessages.en.locationCapturedAt);
    expect(html).toContain('25 m');
  });
});
