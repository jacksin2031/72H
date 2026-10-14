import {expect,it} from 'vitest';
import {acceptPlanExplanation,planExplanationKey} from '../lib/plan-explanation';
import {movementLiveSnapshot,LIVE_NOW} from './live-fixtures';
it('binds explanations to exact approved actions and plan version',()=>{
 const snapshot=movementLiveSnapshot(),plan=snapshot.plans.find(p=>p.id===snapshot.situation.current_plan_id)!;
 const response={plan_id:plan.id,plan_version:plan.version,binding:'a'.repeat(64),language:'zh-TW',mode:'GEMINI_ADK_EXPLANATION',
  created_at:new Date(LIVE_NOW).toISOString(),expires_at:new Date(LIVE_NOW+1000).toISOString(),paragraphs:['依據目前批准行動'],limitations:['不是新的移動授權'],
  evidence_ids:[],fact_ids:[],action_ids:[],explanation_has_authority:false,reason_code:null};
 expect(acceptPlanExplanation(response,snapshot,'zh-TW',LIVE_NOW)).not.toBeNull();
 expect(acceptPlanExplanation({...response,plan_version:plan.version+1},snapshot,'zh-TW',LIVE_NOW)).toBeNull();
 expect(acceptPlanExplanation({...response,action_ids:['fabricated-destination']},snapshot,'zh-TW',LIVE_NOW)).toBeNull();
 expect(acceptPlanExplanation(response,snapshot,'en',LIVE_NOW)).toBeNull();
 expect(acceptPlanExplanation(response,snapshot,'zh-TW',LIVE_NOW+1001)).toBeNull();
 const changed=structuredClone(snapshot);changed.plan_actions[0].status='INVALID';
 expect(planExplanationKey(changed)).not.toBe(planExplanationKey(snapshot));
});
it('rejects plan/evidence expiry even when the same snapshot still says ACTIVE/CURRENT',()=>{
 const snapshot=movementLiveSnapshot(),plan=snapshot.plans.find(p=>p.id===snapshot.situation.current_plan_id)!;
 const evidence=snapshot.evidence.find(e=>e.freshness_status==='CURRENT'&&!e.conflict)!;
 plan.expires_at=new Date(LIVE_NOW+1000).toISOString();evidence.expires_at=plan.expires_at;
 const response={plan_id:plan.id,plan_version:plan.version,binding:'a'.repeat(64),language:'zh-TW',mode:'GEMINI_ADK_EXPLANATION',
  created_at:new Date(LIVE_NOW).toISOString(),expires_at:new Date(LIVE_NOW+300000).toISOString(),paragraphs:['old bound context'],limitations:['not authority'],
  evidence_ids:[evidence.id],fact_ids:[],action_ids:[],explanation_has_authority:false,reason_code:null};
 expect(acceptPlanExplanation(response,snapshot,'zh-TW',LIVE_NOW+2000)).toBeNull();
 plan.expires_at=new Date(LIVE_NOW+10000).toISOString();
 expect(acceptPlanExplanation(response,snapshot,'zh-TW',LIVE_NOW+2000)).toBeNull();
});
it('accepts the backend response shape and checks fact, decision and replay-clock bindings',()=>{
 const snapshot=movementLiveSnapshot(),plan=snapshot.plans.find(p=>p.id===snapshot.situation.current_plan_id)!;
 const base={plan_id:plan.id,plan_version:plan.version,binding:'b'.repeat(64),language:'en',mode:'DETERMINISTIC_FALLBACK',
  created_at:new Date(LIVE_NOW).toISOString(),expires_at:new Date(LIVE_NOW+60000).toISOString(),paragraphs:Array.from({length:20},()=>'bounded'),
  limitations:['not authority'],evidence_ids:[],fact_ids:[],action_ids:[],explanation_has_authority:false,reason_code:'MODEL_DISABLED'};
 // More than 8 actions produce more than 16 backend fallback paragraphs.
 expect(acceptPlanExplanation(base,snapshot,'en',LIVE_NOW)).not.toBeNull();
 expect(acceptPlanExplanation({...base,fact_ids:['invented_fact']},snapshot,'en',LIVE_NOW)).toBeNull();
 const {fact_ids:_,...withoutFacts}=base;
 expect(acceptPlanExplanation(withoutFacts,snapshot,'en',LIVE_NOW)).toBeNull();
 const verified=structuredClone(snapshot);
 verified.situation.claim_states=[{key:'fact_key',status:'VERIFIED',value:'ACTIVE',evidence_ids:[],updated_at:new Date(LIVE_NOW).toISOString()}];
 expect(acceptPlanExplanation({...base,fact_ids:['fact_key']},verified,'en',LIVE_NOW)).not.toBeNull();
 verified.situation.claim_states[0].status='CONFLICT';
 expect(acceptPlanExplanation({...base,fact_ids:['fact_key']},verified,'en',LIVE_NOW)).toBeNull();
 const waiting=structuredClone(snapshot),action=waiting.plan_actions.find(a=>a.plan_id===plan.id)!;
 action.status='ACTIVE';action.safety_decision='WAIT_FOR_EVIDENCE';
 expect(acceptPlanExplanation({...base,action_ids:[action.id]},waiting,'en',LIVE_NOW)).not.toBeNull();
 action.safety_decision='BLOCK';
 expect(acceptPlanExplanation({...base,action_ids:[action.id]},waiting,'en',LIVE_NOW)).toBeNull();
 const replay={...structuredClone(snapshot),replay:{current_time:new Date(Date.parse(plan.expires_at)+1).toISOString()}};
 expect(acceptPlanExplanation(base,replay,'en',LIVE_NOW)).toBeNull();
 replay.replay.current_time=new Date(Date.parse(plan.expires_at)-1).toISOString();
 expect(acceptPlanExplanation(base,replay,'en',LIVE_NOW)).not.toBeNull();
});
