import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildManualRouteSearchOrigin, JudgeFooter, LiveHeaderStatus, preserveAccommodationLocationWhenUnchanged, preserveCurrentLocationForNewSession, ProfileForm } from '../components/live-dashboard';
import { buildInitialLocationProfile, LocationOnboarding } from '../components/location-onboarding';
import { liveMessages } from '../lib/live-i18n';
import { liveProfileSeedSchema, type Language, type Location } from '../lib/contracts';
import type { DeviceLocation } from '../lib/use-device-location';

const idleLocation = {
  position: null, consent: false, ready: true, busy: false, failed: false, permissionDenied: false, permissionGranted: false,
  storageUnavailable: false, state: 'unavailable', freshness: 'UNAVAILABLE', now: 1_800_000_000_000,
  retain: () => {}, locate: async () => null,
} as unknown as DeviceLocation;

describe.each<Language>(['ja', 'en', 'zh-TW'])('first-use UI in %s', language => {
  const messages = liveMessages[language];
  it('does not claim monitoring or a source failure before the first session', () => {
    for (const networkLabel of [messages.sourceStale, messages.offline, messages.reconnecting]) {
      const html = renderToStaticMarkup(<LiveHeaderStatus hasSession={false} busy={false} networkLabel={networkLabel} messages={messages} />);
      expect(html).toContain(messages.setupRequired);
      expect(html).not.toContain(messages.monitor);
      expect(html).not.toContain(networkLabel);
    }
    const querying = renderToStaticMarkup(<LiveHeaderStatus hasSession={false} busy networkLabel={messages.sourceStale} messages={messages} />);
    expect(querying).toContain(messages.refreshing);
    expect(querying).not.toContain(messages.sourceStale);
  });
  it('preserves source and connectivity warnings once a session exists', () => {
    for (const networkLabel of [messages.sourceStale, messages.offline, messages.reconnecting]) {
      const html = renderToStaticMarkup(<LiveHeaderStatus hasSession busy={false} networkLabel={networkLabel} messages={messages} />);
      expect(html).toContain(messages.monitor);
      expect(html).toContain(networkLabel);
    }
  });
  it('starts mobile setup with explicit GPS, nationwide area fallback, and emergency basics without text inputs', () => {
    const html = renderToStaticMarkup(<LocationOnboarding language={language} busy={false} canStart submit={() => {}}
      location={idleLocation} messages={messages} />);
    expect(html).toContain(messages.locationOnboardingTitle);
    expect(html).toContain(messages.locationLocate);
    expect(html).toContain(messages.locationChooseArea);
    expect(html).toContain(`<details class="location-privacy-details"><summary>${messages.locationPrivacySummary}</summary>`);
    expect(messages.locationStart72h).toBeTruthy();
    expect(html).toContain(messages.emergencyBasics);
    expect(html).toContain('tel:119'); expect(html).toContain('tel:110');
    expect(html).not.toContain('<input');
    expect(html).not.toContain(messages.accommodation);
    expect(html).not.toContain(messages.partySize);
  });
  it('keeps the desktop preparedness form self-reported and leaves accommodation optional only on mobile', () => {
    const html = renderToStaticMarkup(<ProfileForm language={language} busy={false} submit={() => {}} title={messages.setup}
      copy={messages.startText} startLabel={messages.begin} messages={messages} />);
    expect(html).toContain(messages.currentLocation);
    expect(html).toContain(messages.accommodation);
    expect(html).toContain(messages.partySize);
    expect(html).toContain(messages.accessibilityNeeds);
    expect(html).toContain(messages.accessibilityMobility);
    expect(html).toContain(messages.accessibilityVision);
    expect(html).toContain(messages.accessibilityHearing);
    expect(html).toContain(messages.accessibilityMedical);
    expect(html).toContain(messages.accessibilityCommunication);
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(5);
  });
  it('builds GPS and user-selected seeds accepted by the initial profile API contract', () => {
    for (const source of ['GPS', 'USER_SELECTED'] as const) {
      const profile = buildInitialLocationProfile({ label: '東京都 新宿区', area_ids: ['JP-MUNI-13104', 'JP-13', 'JP'],
        observed_at: '2026-10-08T01:02:03.000Z', source, accuracy_m: source === 'GPS' ? 25 : undefined });
      expect(liveProfileSeedSchema.safeParse(profile).success).toBe(true);
      expect(profile.current_location).toMatchObject({ label: '東京都 新宿区', area_ids: ['JP-MUNI-13104', 'JP-13', 'JP'],
        observed_at: '2026-10-08T01:02:03.000Z', source, lat: null, lng: null });
      expect(profile.accommodation_location).toMatchObject({ label: '未設定', lat: null, lng: null, area_ids: [], observed_at: null });
      expect(profile.party_size).toBe(1);
      expect(profile.self_reported_safety_status).toBe('UNKNOWN');
    }
  });
  it('renders the translated Judge / Demo footer once', () => {
    const html = renderToStaticMarkup(<JudgeFooter messages={messages} />);
    expect(html).toContain(`${messages.judge} →`);
    expect(html).not.toContain(`${messages.judge} / Demo`);
    expect(html).toContain('href="/demo"');
  });
});

describe('location metadata provenance', () => {
  it('keeps the complete confirmed area chain when re-entering profile setup', () => {
    const current: Location = { label: '東京都 新宿区', lat: null, lng: null,
      area_ids: ['JP-MUNI-13104', 'JP-13', 'JP'], observed_at: '2026-10-08T01:02:03.000Z', source: 'GPS' };
    expect(preserveCurrentLocationForNewSession(current)).toEqual(current);
  });

  it('keeps an unchanged accommodation municipality path when saving other profile metadata', () => {
    const accommodation: Location = { label: '東京都 新宿区', lat: null, lng: null,
      area_ids: ['JP-MUNI-13104', 'JP-13', 'JP'], observed_at: null, source: null };
    expect(preserveAccommodationLocationWhenUnchanged(accommodation, '東京都 新宿区', 'JP-13')).toEqual(accommodation);
  });

  it('marks a manually entered route origin as user-selected instead of inheriting GPS provenance', () => {
    expect(buildManualRouteSearchOrigin(' 新宿駅 ', 35.69, 139.70)).toEqual({ label: '新宿駅', lat: 35.69, lng: 139.70,
      area_ids: [], observed_at: null, source: 'USER_SELECTED' });
  });
});
