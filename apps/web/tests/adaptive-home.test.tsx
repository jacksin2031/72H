import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdaptiveHome } from '../components/adaptive-home';
import { derivePresentation, selectPresentationPolicy } from '../lib/adaptive-ui';
import { derivePower, initialSafetyCheck } from '../lib/vnext';
import type { DeviceLocation } from '../lib/use-device-location';
import { activeSnapshot } from './fixtures';

const location: DeviceLocation = {
  position: null, state: 'unavailable', consent: false, ready: true, busy: false,
  failed: false, storageUnavailable: false, locate: async () => {}, retain: () => {},
};
function render(overrides: Partial<React.ComponentProps<typeof AdaptiveHome>> = {}) {
  const snapshot = activeSnapshot();
  const presentation = derivePresentation(snapshot, Date.parse(snapshot.replay.current_time), 'online', derivePower(90, false), initialSafetyCheck(), { notificationCount: 3 });
  return renderToStaticMarkup(<AdaptiveHome snapshot={snapshot} presentation={presentation} language="en"
    networkState="ONLINE_VERIFIED" planStatus="ACTIVE" notifications={3} actions={snapshot.plan_actions}
    powerMode="NORMAL" location={location} openMap={() => {}} mapClosed={false} {...overrides} />);
}

describe('consumer adaptive home disclosure', () => {
  it('renders one primary NOW and a badge, without mounting map, safety, inbox or power controls', () => {
    const html = render({ mapSurface: <div>MAP_RENDERER</div>, checkControls: <div>SAFETY_CONTROLS</div> });
    expect(html).toContain('id="primary-now"');
    expect(html.match(/id="primary-now"/g)).toHaveLength(1);
    expect(html).toContain('href="/notifications"');
    expect(html).toContain('Notifications · 3');
    expect(html).not.toContain('MAP_RENDERER');
    expect(html).not.toContain('SAFETY_CONTROLS');
    expect(html).not.toContain('power-controls');
    expect(html).not.toContain('class="notifications"');
    expect(html).not.toContain('Replay');
    expect(html).toContain('<details class="plan-sheet"><summary>View details</summary>');
    expect(html).not.toContain('<details class="plan-sheet" open');
  });
  it('keeps map mounting conditional across manual open and close', () => {
    const snapshot = activeSnapshot();
    const p = derivePresentation(snapshot, Date.parse(snapshot.replay.current_time), 'online', derivePower(90, false), initialSafetyCheck(), { manualMapOpen: true });
    expect(render({ presentation: p, mapSurface: <div>MAP_RENDERER</div> })).toContain('MAP_RENDERER');
    const closed = render({ mapClosed: true, mapSurface: <div>MAP_RENDERER</div> });
    expect(closed).not.toContain('MAP_RENDERER');
    expect(closed).toContain('Map closed.');
  });
  it('renders future authorized destination and candidate route without asserting route safety', () => {
    const p = selectPresentationPolicy({ actionState: 'EVACUATE', primaryAction: null, language: 'en',
      power: derivePower(90, false), safetyCheckRequired: false, movementAuthorized: true,
      destinationEligible: true, routeState: 'AVAILABLE', routePresentationAllowed: false,
      networkState: 'ONLINE_VERIFIED', planStatus: 'ACTIVE' });
    const html = render({ presentation: p, mapSurface: <div>MAP_RENDERER</div> });
    expect(html).toContain('data-presentation-mode="MAP_ASSISTED"');
    expect(html).toContain('Destination: Asakusa');
    expect(html).toContain('disaster impact still needs verification');
    expect(html).not.toContain('safe route');
  });
  it('exposes cache age and pending verification after a physical reconnect', () => {
    const html = render({ networkState: 'RECONNECTING' });
    expect(html).toContain('Reconnecting · verification pending');
    expect(html).toContain('Last verified:');
    expect(html).toContain('Cached information · not live');
  });
  it('shows the last verified timestamp for expired information even while online', () => {
    const html = render({ planStatus: 'EXPIRED', networkState: 'ONLINE_VERIFIED' });
    expect(html).toContain('Information has expired');
    expect(html).toContain('Last verified:');
  });
  it('has essential contact and settings but no details, map or permission controls in survival', () => {
    const snapshot = activeSnapshot();
    const p = derivePresentation(snapshot, Date.parse(snapshot.replay.current_time), 'offline', derivePower(3, false), initialSafetyCheck());
    const html = render({ presentation: p, networkState: 'OFFLINE_RECENT', powerMode: 'SURVIVAL', mapSurface: <div>MAP_RENDERER</div> });
    expect(html).toContain('href="tel:119"');
    expect(html).toContain('href="/more"');
    expect(html).toContain('No saved device position');
    expect(html).not.toContain('MAP_RENDERER');
    expect(html).not.toContain('plan-sheet');
    expect(html).not.toContain('type="checkbox"');
  });
});
