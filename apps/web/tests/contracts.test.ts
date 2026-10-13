import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { disasterAssessmentSchema, distressStatusSchema, distressTagSchema, snapshotSchema, tsunamiReferenceSchema } from '../lib/contracts';

const fixture = () => ({
  profile: { id: 'demo-user', preferred_language: 'ja', current_location: { label: 'Shibuya' }, accommodation_location: { label: 'Asakusa' }, current_destination: { label: 'Asakusa' }, party_size: 1, self_reported_safety_status: 'SAFE', created_at: '2026-10-04T17:40:00+09:00', updated_at: '2026-10-04T17:40:00+09:00' },
  situation: { id: 'situation', user_id: 'demo-user', incident_status: 'IDLE', network_state: 'ONLINE_VERIFIED', active_event_ids: [], current_plan_id: null, latest_evidence_at: null, uncertainty_flags: [], conflict_flags: [], created_at: '2026-10-04T17:40:00+09:00', updated_at: '2026-10-04T17:40:00+09:00' },
  events: [], evidence: [], plans: [], plan_actions: [], trace: [], mobility: [], plan_evaluations: [], scenario_events: [],
  replay: { id: 'replay-session', scenario_key: 'tokyo-earthquake-v1', status: 'READY', speed: 1, current_event_index: 0, current_time: '2026-10-04T17:40:00+09:00', mode: 'SYNTHETIC_REPLAY', planning_mode: 'DETERMINISTIC_REPLAY_ONLY' },
});
describe('Snapshot boundary', () => {
  it('projects only approved public fields before offline storage', () => {
    const result = snapshotSchema.parse({ ...fixture(), authorization: 'must-never-cache', hidden_reasoning: 'must-never-render' });
    expect(result).not.toHaveProperty('authorization');
    expect(result).not.toHaveProperty('hidden_reasoning');
  });
  it('rejects cached current-plan references with no plan', () => {
    const value = fixture();
    expect(snapshotSchema.safeParse({ ...value, situation: { ...value.situation, current_plan_id: 'invented' } }).success).toBe(false);
  });
  it('rejects invented mobility safety and unlabelled live data', () => {
    const value = fixture();
    expect(snapshotSchema.safeParse({ ...value, mobility: [{ id: 'route', status: 'SAFE', evidence_ids: [] }] }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...value, replay: { ...value.replay, mode: 'LIVE' } }).success).toBe(false);
  });
  it('rejects replay positions outside the validated timeline', () => {
    const value = fixture();
    expect(snapshotSchema.safeParse({ ...value, replay: { ...value.replay, current_event_index: 10 } }).success).toBe(false);
  });
  it('keeps old earthquake snapshots typed as earthquakes and tsunami heights outside L0-L4', () => {
    const value = fixture();
    const oldSnapshot = snapshotSchema.parse({
      ...value,
      events: [{
        id: 'legacy-earthquake-event', event_type: 'EARTHQUAKE', occurred_at: '2026-10-04T17:40:00+09:00',
        affected_areas: ['東京'], source_name: 'JMA replay', raw_reference: 'replay://old-earthquake',
      }],
    });
    expect(oldSnapshot.events[0].event_type).toBe('EARTHQUAKE');
    expect(disasterAssessmentSchema.safeParse({ area_id: 'JP-04', event_type: 'TSUNAMI', level: 'L4', status: 'ACTIVE' }).success).toBe(false);
    expect(disasterAssessmentSchema.parse({ area_id: 'JP-04', event_type: 'TSUNAMI', level: null, status: 'ACTIVE' }).level).toBeNull();
  });
  it('validates tsunami reference separately from historical snapshots and fails stale areas closed', () => {
    const current = {
      mode: 'LIVE_REFERENCE', event_type: 'TSUNAMI', status: 'ACTIVE', source_status: 'CURRENT',
      source: {
        source_id: 'jma-bosai-xml', product_code: 'VTSE41', name: 'JMA tsunami warnings',
        url: 'https://www.data.jma.go.jp/developer/xml/data/current_VTSE41.xml',
        published_at: '2026-10-06T01:00:00+00:00', fetched_at: '2026-10-06T01:00:01+00:00',
        operation: 'ISSUE', serial: '1',
      },
      forecast_areas: [{
        area_code: '220', area_name: '宮城県', status: 'ACTIVE', warning_class: 'MAJOR_WARNING',
        max_height: { value_m: null, expression: 'HUGE', description: '巨大' }, arrival_at: null,
      }],
      safety_authority: 'NONE',
    };
    expect(tsunamiReferenceSchema.parse(current).event_type).toBe('TSUNAMI');
    expect(tsunamiReferenceSchema.safeParse({ ...current, status: 'CANCELLED' }).success).toBe(false);
    expect(tsunamiReferenceSchema.safeParse({ ...current, status: 'UNKNOWN' }).success).toBe(false);
    expect(tsunamiReferenceSchema.safeParse({
      ...current, status: 'UNKNOWN', source_status: 'STALE',
    }).success).toBe(false);
  });
  if (process.env.CONTRACT_FIXTURE) {
    it('accepts the actual running API snapshot', () => {
      const file = resolve(process.env.CONTRACT_FIXTURE!);
      expect(snapshotSchema.safeParse(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))).success).toBe(true);
    });
  }
  it('accepts the distress status and rejects non-whitelisted tags', () => {
    expect(distressStatusSchema.parse({level:'USER_REPORTED',reports:[{id:'d1',tags:['TRAPPED'],input_mode:'BUTTON',reported_at:'2026-10-13T08:00:00Z',source:'USER_REPORTED'}],trigger_evidence_ids:[],deadline_at:null,ai_escalated:false,synthetic:false}).level).toBe('USER_REPORTED');
    expect(() => distressTagSchema.parse('SAFE_HERE')).toThrow();
  });
  it('keeps OFFICIAL_STALE and the official basis fields instead of stripping them', () => {
    const parsed = distressStatusSchema.parse({level:'OFFICIAL_STALE',reports:[],trigger_evidence_ids:['ev-1'],deadline_at:null,ai_escalated:false,synthetic:true,
      warning_class:'MAJOR_WARNING',last_official_at:'2026-10-13T08:00:00Z',trigger_expires_at:'2026-10-13T08:15:00Z'});
    expect(parsed).toMatchObject({level:'OFFICIAL_STALE',warning_class:'MAJOR_WARNING',last_official_at:'2026-10-13T08:00:00Z',trigger_expires_at:'2026-10-13T08:15:00Z'});
    const legacy = distressStatusSchema.parse({level:'NONE',reports:[],trigger_evidence_ids:[],deadline_at:null,ai_escalated:false,synthetic:false});
    expect(legacy).toMatchObject({warning_class:null,last_official_at:null,trigger_expires_at:null});
  });
  it('keeps the OFFICIAL_STALE stale_reason (F2) and defaults it to null for older snapshots', () => {
    const base = {level:'OFFICIAL_STALE',reports:[],trigger_evidence_ids:['ev-1'],deadline_at:null,ai_escalated:false,synthetic:false};
    expect(distressStatusSchema.parse({...base,stale_reason:'LOCATION_STALE'}).stale_reason).toBe('LOCATION_STALE');
    expect(distressStatusSchema.parse({...base,stale_reason:'EVIDENCE_EXPIRED'}).stale_reason).toBe('EVIDENCE_EXPIRED');
    expect(distressStatusSchema.parse(base).stale_reason).toBeNull();
    expect(() => distressStatusSchema.parse({...base,stale_reason:'WHATEVER'})).toThrow();
  });
});
