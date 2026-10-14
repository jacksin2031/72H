"""No real model calls: controlled runner output tests the actual gates and API."""
import asyncio
import importlib.util
from datetime import datetime,timedelta,timezone

import pytest
from fastapi.testclient import TestClient
from agent_api.main import create_app
from agent_api.mock_live import MockLiveDrillStore
from agent_api.planner import CandidatePlanner,PlannerConfig

NOW=datetime.now(timezone.utc)
KEY='TEST_ONLY_SIMULATION_ACCESS_KEY_32_CHARS'


def module():
    assert importlib.util.find_spec('agent_api.simulation_advice') is not None, 'Location-aware Gemini assessment missing'
    from agent_api import simulation_advice
    return simulation_advice


def location(m,source='USER_SELECTED',at=NOW):
    return m.SimulationLocation(area_ids=('JP-MUNI-04202','JP-04','JP'),source=source,observed_at=at)


def envelope(m,**values):
    conditions=m.SimulationConditions(**values)
    return m.build_advice_envelope(location(m),conditions,event_kind='TSUNAMI_WARNING',
        mobility='ABLE',network='ONLINE',evidence='FRESH',step=2,session_id='TEST_SESSION',plan_id=None,now=NOW)


def test_coastal_warning_needs_explicit_simulated_ground_and_route_proof():
    m=module()
    assert envelope(m,site='COASTAL_LOWLAND',shaking='AFTER')['allowed_decisions']==['UNKNOWN']
    valid=envelope(m,site='COASTAL_LOWLAND',shaking='AFTER',high_ground='VERIFIED_IN_SCENARIO',route='PASSABLE_IN_SCENARIO')
    assert 'HIGH_GROUND' in valid['allowed_decisions'] and 'STAY_PROTECT' not in valid['allowed_decisions']
    assert valid['area_ids']==['JP-MUNI-04202','JP-04','JP']
    assert valid['context_kind']=='SIMULATED_ASSUMPTIONS_APPLIED_TO_SELECTED_AREA'
    assert envelope(m,site='INDOOR',shaking='AFTER',building='INTACT_IN_SCENARIO')['allowed_decisions']==['UNKNOWN']
    assert envelope(m,site='COASTAL_LOWLAND',shaking='DURING',high_ground='VERIFIED_IN_SCENARIO',route='PASSABLE_IN_SCENARIO')['allowed_decisions']==['STAY_PROTECT','UNKNOWN']
    aftershock=m.build_advice_envelope(location(m),m.SimulationConditions(site='COASTAL_LOWLAND',shaking='AFTER',high_ground='VERIFIED_IN_SCENARIO',route='PASSABLE_IN_SCENARIO'),
        event_kind='AFTERSHOCK',tsunami_active=True,mobility='ABLE',network='ONLINE',evidence='FRESH',step=4,session_id='TEST',plan_id=None,now=NOW)
    assert aftershock['allowed_decisions']==['HIGH_GROUND','UNKNOWN']


def test_shelter_and_stay_are_different_gated_decisions():
    m=module()
    e=m.build_advice_envelope(location(m),m.SimulationConditions(shaking='AFTER',site='INDOOR',building='DAMAGED_IN_SCENARIO',shelter='OPEN_IN_SCENARIO',route='PASSABLE_IN_SCENARIO'),
        event_kind='EARTHQUAKE',mobility='ABLE',network='ONLINE',evidence='FRESH',step=1,session_id='TEST',plan_id=None,now=NOW)
    assert 'EVACUATE_SHELTER' in e['allowed_decisions'] and 'STAY_PROTECT' not in e['allowed_decisions']
    during=m.build_advice_envelope(location(m),m.SimulationConditions(),event_kind='EARTHQUAKE',mobility='ABLE',network='ONLINE',evidence='FRESH',step=1,session_id='TEST',plan_id=None,now=NOW)
    assert during['allowed_decisions']==['STAY_PROTECT','UNKNOWN']


def test_unknown_expired_location_stale_evidence_and_mobility_fail_closed():
    m=module()
    kwargs=dict(event_kind='TSUNAMI_WARNING',mobility='ABLE',network='ONLINE',evidence='FRESH',step=2,session_id='TEST',plan_id=None,now=NOW)
    c=m.SimulationConditions(site='COASTAL_LOWLAND',shaking='AFTER',high_ground='VERIFIED_IN_SCENARIO',route='PASSABLE_IN_SCENARIO')
    assert m.build_advice_envelope(None,c,**kwargs)['allowed_decisions']==['UNKNOWN']
    assert m.build_advice_envelope(location(m,'GPS',NOW-timedelta(seconds=121)),c,**kwargs)['allowed_decisions']==['UNKNOWN']
    assert m.build_advice_envelope(location(m),c,**(kwargs|dict(evidence='STALE')))['allowed_decisions']==['UNKNOWN']
    assert m.build_advice_envelope(location(m),c,**(kwargs|dict(mobility='CANNOT_MOVE')))['allowed_decisions']==['ASSISTANCE','UNKNOWN']
    assert m.build_advice_envelope(None,c,**(kwargs|dict(mobility='CANNOT_MOVE',evidence='UNKNOWN')))['allowed_decisions']==['ASSISTANCE','UNKNOWN']


class ChoosingRunner:
    def __init__(self,decision='HIGH_GROUND',invalid=None): self.contexts=[];self.decision=decision;self.invalid=invalid
    async def run_assessment(self,context,config):
        self.contexts.append(context)
        result=dict(version=context['version'],decision=self.decision,
            fact_ids=[f['id'] for f in context['facts']],limitation_ids=context['limitation_ids'])
        if self.invalid=='version':result['version']='wrong'
        if self.invalid=='fact':result['fact_ids']=['INVENTED_DESTINATION']
        if self.invalid=='limit':result['limitation_ids']=[]
        if self.invalid=='prose':result['route']='Go to fabricated safe shelter'
        return result


def test_real_assessment_boundary_checks_ids_version_and_limits_without_coordinate_upload():
    m=module(); e=envelope(m,site='COASTAL_LOWLAND',shaking='AFTER',high_ground='VERIFIED_IN_SCENARIO',route='PASSABLE_IN_SCENARIO')
    for invalid in (None,'version','fact','limit','prose'):
        runner=ChoosingRunner(invalid=invalid);advisor=m.SimulationAdvisor(config=PlannerConfig(mode='gemini'),runner=runner)
        result=asyncio.run(advisor.assess(e))
        assert result.decision==('HIGH_GROUND' if invalid is None else 'UNKNOWN')
        assert result.ai_mode==('GEMINI_ADK' if invalid is None else 'GEMINI_ADK_FALLBACK')
        assert result.route_authorized is False and result.safe_location_verified is False
        assert all(k not in repr(runner.contexts) for k in ('latitude','longitude','lat":','lng":'))
    blocked=m.SimulationAdvisor(config=PlannerConfig(mode='gemini'),runner=ChoosingRunner(decision='EVACUATE_SHELTER'))
    assert asyncio.run(blocked.assess(e)).decision=='UNKNOWN'


def test_new_api_uses_selected_user_area_and_does_not_mutate_real_movement_plan(monkeypatch):
    m=module();monkeypatch.setenv('DRILL_ACCESS_KEY',KEY)
    runner=ChoosingRunner(decision='STAY_PROTECT')
    store=MockLiveDrillStore(planner=CandidatePlanner(PlannerConfig(mode='deterministic')),advisor=m.SimulationAdvisor(config=PlannerConfig(mode='gemini'),runner=runner))
    client=TestClient(create_app(mock_live_store=store))
    request=dict(historical_case='tohoku-2011',use_gemini=True,
        location_context=location(m).model_dump(mode='json'),conditions={'site':'INDOOR'})
    response=client.post('/api/mock-live/start',headers={'X-Drill-Key':KEY},json=request)
    assert response.status_code==201,response.text
    sid=response.json()['snapshot']['session_id'];assert not runner.contexts,'No AI before event'
    value=client.post(f'/api/mock-live/{sid}/next',headers={'X-Drill-Key':KEY}).json()
    assert value['movement_assessment']['ai_mode']=='GEMINI_ADK'
    assert value['movement_assessment']['step']==value['current_step']==1
    assert value['snapshot']['profile']['current_location']['area_ids']==['JP-MUNI-04202','JP-04','JP']
    assert value['snapshot']['spatial_guidance']['movement_authorized'] is False
    assert value['snapshot']['routes']==[] and value['snapshot']['destinations']==[]
    request['location_context']['lat']=38.4
    assert client.post('/api/mock-live/start',headers={'X-Drill-Key':KEY},json=request).status_code==422
    request['location_context'].pop('lat');request['location_context']['area_ids']=['JP-MUNI-04202','JP-13','JP']
    assert client.post('/api/mock-live/start',headers={'X-Drill-Key':KEY},json=request).status_code==422


def test_missing_user_location_is_not_replaced_by_historical_area(monkeypatch):
    m=module();monkeypatch.setenv('DRILL_ACCESS_KEY',KEY)
    store=MockLiveDrillStore(planner=CandidatePlanner(PlannerConfig(mode='deterministic')),advisor=m.SimulationAdvisor(config=PlannerConfig(mode='gemini'),runner=ChoosingRunner(decision='UNKNOWN')))
    client=TestClient(create_app(mock_live_store=store))
    result=client.post('/api/mock-live/start',headers={'X-Drill-Key':KEY},json={'historical_case':'tohoku-2011','use_gemini':True}).json()
    assert result['snapshot']['profile']['current_location']['area_ids']==[]
    assert result['snapshot']['profile']['accommodation_location']['area_ids']==[]
    sid=result['snapshot']['session_id']
    result=client.post(f'/api/mock-live/{sid}/next',headers={'X-Drill-Key':KEY}).json()
    assert result['movement_assessment']['area_ids']==[] and result['movement_assessment']['decision']=='UNKNOWN'
    request={'use_gemini':True,'location_context':location(m,'GPS',NOW-timedelta(seconds=121)).model_dump(mode='json')}
    result=client.post('/api/mock-live/start',headers={'X-Drill-Key':KEY},json=request)
    assert result.status_code==201,result.text
    assert result.json()['snapshot']['profile']['current_location']['area_ids']==[]


def test_offline_timeout_expiry_and_session_budget_never_claim_success():
    m=module();e=envelope(m,site='COASTAL_LOWLAND',shaking='AFTER',high_ground='VERIFIED_IN_SCENARIO',route='PASSABLE_IN_SCENARIO')
    runner=ChoosingRunner()
    advisor=m.SimulationAdvisor(config=PlannerConfig(mode='gemini',max_calls_per_session=1),runner=runner)
    assert asyncio.run(advisor.assess(e)).ai_mode=='GEMINI_ADK'
    assert asyncio.run(advisor.assess(e)).decision=='UNKNOWN'
    assert len(runner.contexts)==1
    offline=m.build_advice_envelope(location(m),m.SimulationConditions(),event_kind='EARTHQUAKE',mobility='ABLE',network='RECONNECTING',evidence='FRESH',step=1,session_id='OTHER',plan_id=None,now=NOW)
    assert asyncio.run(advisor.assess(offline)).ai_mode=='NOT_RUN'
    assert len(runner.contexts)==1
    class SlowRunner:
        async def run_assessment(self,context,config):await asyncio.sleep(.05)
    timeout=m.SimulationAdvisor(config=PlannerConfig(mode='gemini',timeout_seconds=.001),runner=SlowRunner())
    result=asyncio.run(timeout.assess(e));assert result.reason_code=='TIMEOUT' and result.decision=='UNKNOWN'
    expired={**e,'expires_at':(NOW-timedelta(seconds=1)).isoformat()}
    result=asyncio.run(m.SimulationAdvisor(config=PlannerConfig(mode='gemini'),runner=ChoosingRunner()).assess(expired))
    assert result.ai_mode=='NOT_RUN' and result.reason_code=='CONTEXT_EXPIRED' and result.decision=='UNKNOWN'
