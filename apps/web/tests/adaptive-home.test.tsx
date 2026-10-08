import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdaptiveHome } from '../components/adaptive-home';
import { derivePresentation, selectPresentationPolicy } from '../lib/adaptive-ui';
import { derivePower, initialSafetyCheck } from '../lib/vnext';
import { projectLiveSnapshot } from '../lib/live-presentation';
import type { DeviceLocation } from '../lib/use-device-location';
import { activeSnapshot } from './fixtures';
import { LIVE_NOW, movementLiveSnapshot } from './live-fixtures';

const location: DeviceLocation = {
  position: null, state: 'unavailable', freshness: 'UNAVAILABLE', now: Date.now(), consent: false, ready: true, busy: false,
  failed: false, permissionDenied: false, permissionGranted: false, storageUnavailable: false, locate: async () => null, retain: () => {},
};
function render(overrides: Partial<React.ComponentProps<typeof AdaptiveHome>> = {}) {
  const snapshot = activeSnapshot();
  const presentation = derivePresentation(snapshot, Date.parse(snapshot.replay.current_time), 'online', derivePower(90, false), initialSafetyCheck(), { notificationCount: 3 });
  return renderToStaticMarkup(<AdaptiveHome snapshot={snapshot} presentation={presentation} language="en"
    networkState="ONLINE_VERIFIED" planStatus="ACTIVE" notifications={3} actions={snapshot.plan_actions}
    powerMode="NORMAL" location={location} mapClosed={false} {...overrides} />);
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
    expect(html).toContain('class="plan-sheet-trigger"');
    expect(html).not.toContain('role="dialog"');
  });
  it('never mounts the replay map after an unauthorized manual open', () => {
    const snapshot = activeSnapshot();
    const p = derivePresentation(snapshot, Date.parse(snapshot.replay.current_time), 'online', derivePower(90, false), initialSafetyCheck(), { manualMapOpen: true });
    expect(render({ presentation: p, mapSurface: <div>MAP_RENDERER</div> })).not.toContain('MAP_RENDERER');
    const closed = render({ mapClosed: true, mapSurface: <div>MAP_RENDERER</div> });
    expect(closed).not.toContain('MAP_RENDERER');
    expect(closed).toContain('Map closed.');
  });
  it('renders a map only when movement, destination, verified route geometry and server gate pass', () => {
    const p = selectPresentationPolicy({ actionState: 'EVACUATE', primaryAction: null, language: 'en',
      power: derivePower(90, false), safetyCheckRequired: false, movementAuthorized: true,
      destinationEligible: true, routeState: 'AVAILABLE', routePresentationAllowed: true,
      routeGeometryValid: true, mapMountEligible: true,
      networkState: 'ONLINE_VERIFIED', planStatus: 'ACTIVE' });
    const html = render({ presentation: p, mapSurface: <div>MAP_RENDERER</div> });
    expect(html).toContain('data-presentation-mode="MAP_ASSISTED"');
    expect(html).toContain('Destination: Asakusa');
    expect(html).toContain('Verified usable candidate');
    expect(html).not.toContain('safe route');
  });
  it('renders the server-selected LIVE shelter rather than a profile hotel label', () => {
    const snapshot = movementLiveSnapshot();
    snapshot.profile.current_destination = { ...snapshot.profile.current_location, label: 'Profile hotel destination' };
    const projection = projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(80, false));
    expect(projection.mapGate).toBe(true);
    const html = render({ snapshot, presentation: projection.presentation, actions: snapshot.plan_actions,
      networkState: projection.networkState, planStatus: projection.planStatus });
    expect(html).toContain('Destination: Asakusa designated shelter');
    expect(html).not.toContain('Profile hotel destination');
  });
  it('does not render a HIGH evacuation NOW instruction or map after the LIVE route expires', () => {
    const snapshot = movementLiveSnapshot();
    const highEvacuation = snapshot.plan_actions[0];
    const lowFallback = { ...highEvacuation, id: 'action-live-low', text: 'Wait for the latest verified update.', risk_level: 'LOW' as const,
      intent_id: 'wait_for_transport_update' as const, evidence_ids: [], dependency_keys: [], dependency_values: {} };
    snapshot.plan_actions.push(lowFallback);
    const expires = new Date(LIVE_NOW - 1).toISOString();
    snapshot.routes[0].expires_at = expires;
    snapshot.spatial_guidance.route!.expires_at = expires;
    const projection = projectLiveSnapshot(snapshot, LIVE_NOW, 'online', derivePower(80, false));
    const actions = snapshot.plan_actions.filter(item => !projection.invalidActionIds.includes(item.id));
    const html = render({ snapshot, presentation: projection.presentation, actions,
      networkState: projection.networkState, planStatus: projection.planStatus, mapSurface: <div>LIVE_ROUTE_MAP</div> });
    expect(html).not.toContain(highEvacuation.text);
    expect(html).not.toContain('LIVE_ROUTE_MAP');
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
  it.each(['SAFETY_CHECK', 'EMERGENCY_PROTECT'] as const)(
    'does not render the details overlay entry during %s takeover and keeps help actions visible', mode => {
      const snapshot = activeSnapshot();
      const base = derivePresentation(snapshot, Date.parse(snapshot.replay.current_time), 'online', derivePower(90, false), initialSafetyCheck());
      const presentation = { ...base, mode, showSafetyCheck: mode === 'SAFETY_CHECK' };
      const html = render({ presentation, powerMode: 'EMERGENCY_POWER', checkControls: <button type="button">Respond to safety check</button> });
      expect(html).not.toContain('class="plan-sheet-trigger"');
      expect(html).not.toContain('class="plan-sheet-backdrop"');
      expect(html).not.toContain('role="dialog"');
      expect(html).not.toContain('notification-badge');
      expect(html).not.toContain('class="essential-settings"');
      expect(html).not.toContain('href="/more"');
      expect(html).toContain('href="tel:119"');
      if (mode === 'SAFETY_CHECK') expect(html).toContain('Respond to safety check');
    },
  );
});
