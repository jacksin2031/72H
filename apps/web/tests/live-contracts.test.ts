import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveSnapshotSchema } from '../lib/contracts';
import { activeSnapshot } from './fixtures';

const at = '2026-10-06T01:00:00Z';

function liveFixture() {
  const base = activeSnapshot();
  const source = (source_key: string) => ({ source_key, source_name: source_key,
    source_url: 'https://example.gov.jp/source', status: 'FRESH', retrieved_at: at,
    last_published_at: at, next_retry_at: null, record_count: 0, detail: 'fixture' });
  return {
    session_id: 'f247799c-95d9-4d77-a830-f978e7e1352a', mode: 'LIVE',
    source: source('JMA_DISASTER_XML'), destination_source: source('TOKYO_SHELTER_CSV'), route_source: source('EKISPERT'),
    profile: base.profile, area_catalog: base.area_catalog,
    situation: { ...base.situation, id: 'live-situation', current_plan_id: null, latest_evidence_at: null,
      network_state: 'ONLINE_VERIFIED', active_event_ids: [], conflict_flags: [], claim_states: [] },
    events: [], evidence: [], evidence_projections: [], plans: [], plan_actions: [], trace: [], plan_evaluations: [],
    destinations: [], routes: [], spatial_guidance: { current_action_kind: 'MONITOR', movement_authorized: false,
      destination: null, route: null, plan_id: null, action_id: null, evaluated_at: at, gate_reasons: [], map_mount_eligible: false },
  };
}

describe('LIVE contract boundary', () => {
  it('accepts a scoped official live event with its situation identity', () => {
    const value = { ...liveFixture(), events: [{ id: 'evt-live', situation_id: 'live-situation', event_type: 'EARTHQUAKE', occurred_at: at,
      received_at: at, affected_areas: ['Shibuya'], affected_area_ids: ['JP-13-SHIBUYA'], source_name: 'JMA',
      source_class: 'OFFICIAL', severity_raw: 'JMA intensity 4', status: 'ACTIVE', raw_reference: 'https://jma.go.jp/feed', is_synthetic: false }] };
    expect(liveSnapshotSchema.safeParse(value).success).toBe(true);
  });

  it('rejects synthetic events and events from another situation in LIVE mode', () => {
    const event = { id: 'evt-live', situation_id: 'live-situation', event_type: 'EARTHQUAKE', occurred_at: at,
      received_at: at, affected_areas: ['Shibuya'], affected_area_ids: ['JP-13-SHIBUYA'], source_name: 'JMA',
      source_class: 'OFFICIAL', severity_raw: 'JMA intensity 4', status: 'ACTIVE', raw_reference: 'https://jma.go.jp/feed', is_synthetic: false };
    expect(liveSnapshotSchema.safeParse({ ...liveFixture(), events: [{ ...event, is_synthetic: true }] }).success).toBe(false);
    expect(liveSnapshotSchema.safeParse({ ...liveFixture(), events: [{ ...event, situation_id: 'other-situation' }] }).success).toBe(false);
  });

  it('accepts a captured real API payload when LIVE_API_FIXTURE is supplied', () => {
    const path = process.env.LIVE_API_FIXTURE;
    if (!path) return;
    const payload = JSON.parse(readFileSync(resolve(path), 'utf8').replace(/^\uFEFF/, ''));
    expect(liveSnapshotSchema.safeParse(payload).success).toBe(true);
  });
});
