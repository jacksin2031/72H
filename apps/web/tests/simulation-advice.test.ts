import {expect,it} from 'vitest';
import * as module from '../lib/simulation-advice';

const now=Date.parse('2026-10-13T00:00:00Z');
const fixture={authority:'SIMULATION_REFERENCE_ONLY',version:'a'.repeat(64),session_id:'TEST_SESSION',step:2,plan_id:null,
  decision:'HIGH_GROUND',allowed_decisions:['HIGH_GROUND','UNKNOWN'],area_ids:['JP-MUNI-04202','JP-04','JP'],area_label:'石巻市',location_source:'USER_SELECTED',
  location_observed_at:new Date(now).toISOString(),created_at:new Date(now).toISOString(),expires_at:new Date(now+300000).toISOString(),
  facts:[{id:'LOCATION',value:'TEST_ONLY'}],fact_ids:['LOCATION'],limitation_ids:['SIMULATION_ONLY','NOT_LIVE_AUTHORITY','NO_SAFE_ROUTE','LOCATION_NOT_SAFETY'],
  ai_mode:'GEMINI_ADK',reason_code:null,route_authorized:false,safe_location_verified:false};
it('expires advice on wall time and blocks old step/plan or offline input',()=>{
  expect(module.simulationAssessmentSchema,'Simulation assessment validator missing').toBeDefined();
  const advice=module.simulationAssessmentSchema.parse(fixture);
  expect(module.activeSimulationAdvice(advice,{session_id:'TEST_SESSION',step:2,plan_id:null},true,now)?.decision).toBe('HIGH_GROUND');
  expect(module.activeSimulationAdvice(advice,{session_id:'TEST_SESSION',step:3,plan_id:null},true,now)).toBeNull();
  expect(module.activeSimulationAdvice(advice,{session_id:'TEST_SESSION',step:2,plan_id:'other'},true,now)).toBeNull();
  expect(module.activeSimulationAdvice(advice,{session_id:'TEST_SESSION',step:2,plan_id:null},false,now)).toBeNull();
  expect(module.activeSimulationAdvice(advice,{session_id:'TEST_SESSION',step:2,plan_id:null},true,now+300000)).toBeNull();
  expect(module.activeSimulationAdvice(advice,{session_id:'OTHER',step:2,plan_id:null},true,now)).toBeNull();
  expect(module.activeSimulationAdvice({...advice,location_source:'GPS',location_observed_at:new Date(now-120001).toISOString()},{session_id:'TEST_SESSION',step:2,plan_id:null},true,now)).toBeNull();
});
it('rejects missing restrictions, invented choice and movement or route authority',()=>{
  expect(module.simulationAssessmentSchema).toBeDefined();
  for(const extra of [{decision:'EVACUATE_SHELTER'},{limitation_ids:[]},{fact_ids:['INVENTED']},{route_authorized:true},
    {safe_location_verified:true},{ai_mode:'GEMINI_ADK_FALLBACK',decision:'HIGH_GROUND'}])
    expect(module.simulationAssessmentSchema.safeParse({...fixture,...extra}).success).toBe(false);
});
