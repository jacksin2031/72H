import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmergencyMap } from '../components/emergency-map';
import { EarthquakeIndicator } from '../components/earthquake-indicator';
import type { DeviceLocation } from '../lib/use-device-location';

const event = { id: 'quake-1', occurredAt: '2026-10-10T01:00:00Z', synthetic: true };
describe('earthquake illustration disclosure', () => {
  it('labels replay and explicitly excludes epicentre and hazard-extent claims', () => {
    const html = renderToStaticMarkup(<EarthquakeIndicator language="zh-TW" event={event} conserve={false} />);
    expect(html).toContain('地震事件（模擬）');
    expect(html).toContain('不代表震央位置或震動影響範圍');
    expect(html).toContain('10:00:00');
  });
  it('retains the event timestamp and static illustration in conservation mode', () => {
    const html = renderToStaticMarkup(<EarthquakeIndicator language="en" event={{ ...event, synthetic: false }} conserve />);
    expect(html).toContain('is-static');
    expect(html).not.toContain('(simulation)');
    expect(html).toContain('2026-10-10T01:00:00Z');
  });
  it('shows no earthquake indicator when no active event is supplied', () => {
    const location = { position: null, freshness: 'UNAVAILABLE' } as DeviceLocation;
    const html = renderToStaticMarkup(<EmergencyMap language="en" conserve={false} location={location} />);
    expect(html).not.toContain('earthquake-indicator');
  });
});
