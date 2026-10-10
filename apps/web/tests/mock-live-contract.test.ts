import { describe, expect, it } from 'vitest';
import { liveSnapshotSchema } from '../lib/contracts';
import { mockLiveSnapshotSchema } from '../lib/mock-live-contract';
import { activeSnapshot } from './fixtures';

function mockFixture() {
  const base=activeSnapshot();
  const at='2026-10-10T19:00:00+09:00';
  const source=(source_key:string, url:string)=>({
    source_key,source_name:'SIMULATED '+source_key,source_url:url,
    status:'FRESH',retrieved_at:at,last_published_at:at,next_retry_at:null,
    record_count:1,detail:'MOCK ONLY',
  });
  return {
    session_id:'f247799c-95d9-4d77-a830-f978e7e1352a', mode:'LIVE',
    source:source('JMA_DISASTER_XML','mock://72h/jma'),
    destination_source:source('TOKYO_SHELTER_CSV','mock://72h/shelter'),
    route_source:source('EKISPERT','mock://72h/routes'),
    profile:base.profile,area_catalog:base.area_catalog,
    situation:{...base.situation,id:'live-situation',current_plan_id:null,latest_evidence_at:at,
      active_event_ids:[],conflict_flags:[],claim_states:[]},
    events:[{
      id:'event-mock',situation_id:'live-situation',event_type:'EARTHQUAKE',
      occurred_at:at,received_at:at,affected_areas:['Tokyo'],affected_area_ids:['JP-13'],
      source_name:'SIMULATED JMA',source_class:'OFFICIAL',severity_raw:'MOCK intensity 7',
      status:'ACTIVE',raw_reference:'mock://72h/historical/tohoku-2011/1',is_synthetic:true,
    }],
    evidence:[{
      ...base.evidence[0],id:'evidence-mock',situation_id:'live-situation',source_key:'JMA_DISASTER_XML',
      source_name:'SIMULATED JMA',is_synthetic:true,eligible_for_high_risk:false,
    }],
    evidence_projections:[],plans:[],plan_actions:[],trace:[],plan_evaluations:[],
    destinations:[],routes:[],
    spatial_guidance:{current_action_kind:'MONITOR',movement_authorized:false,
      destination:null,route:null,plan_id:null,action_id:null,evaluated_at:at,
      gate_reasons:[],map_mount_eligible:false},
  };
}

describe('isolated Mock Live contract boundary',()=>{
  it('accepts 4-step synthetic historical output without misrepresenting official provenance',()=>{
    const snapshot=mockFixture();
    const data=mockLiveSnapshotSchema.parse(snapshot);
    expect(data.source.source_url).toBe('mock://72h/jma');
    expect(data.evidence[0].is_synthetic).toBe(true);
    expect(data.events[0].is_synthetic).toBe(true);
    expect(liveSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
  it('rejects non-synthetic evidence or real official source passed as Mock Live',()=>{
    const source=mockFixture();
    expect(mockLiveSnapshotSchema.safeParse({...source,source:{...source.source,source_url:'https://jma.go.jp'}}).success).toBe(false);
    expect(mockLiveSnapshotSchema.safeParse({...source,evidence:[{...source.evidence[0],is_synthetic:false}]}).success).toBe(false);
    expect(mockLiveSnapshotSchema.safeParse({...source,events:[{...source.events[0],is_synthetic:false}]}).success).toBe(false);
  });
  it('rejects motion, map mounting and high-risk plans even when synthetic',()=>{
    const sample=mockFixture();
    expect(mockLiveSnapshotSchema.safeParse({
      ...sample,spatial_guidance:{...sample.spatial_guidance,movement_authorized:true}
    }).success).toBe(false);
    expect(mockLiveSnapshotSchema.safeParse({
      ...sample,spatial_guidance:{...sample.spatial_guidance,map_mount_eligible:true}
    }).success).toBe(false);
    expect(mockLiveSnapshotSchema.safeParse({
      ...sample,plan_actions:[{id:'unsafe',risk_level:'HIGH',safety_decision:'ALLOW'}]
    }).success).toBe(false);
  });
});
