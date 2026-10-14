"""Synthetic adapter fixtures; none represent actual municipal opening reports."""
from datetime import datetime, timedelta, timezone
import importlib.util

import pytest
from fastapi.testclient import TestClient
from agent_api.main import create_app

NOW = datetime(2026, 10, 12, 10, 30, tzinfo=timezone.utc)


def module():
    assert importlib.util.find_spec('agent_api.place_opening') is not None, 'Opening adapter boundary missing'
    from agent_api import place_opening
    return place_opening


def registration(m):
    return m.OpeningAuthority(source_key='TEST_ONLY', area_id='JP-MUNI-04202',
        source_url='https://www.city.ishinomaki.lg.jp/TEST_ONLY', destination_ids=('gsi-TEST01',),
        reviewed_at=NOW-timedelta(days=1), review_due_at=NOW+timedelta(days=1))


def observation(m, status='OPEN', **extra):
    values=dict(id='TEST_REPORT', destination_id='gsi-TEST01', area_id='JP-MUNI-04202',
        source_key='TEST_ONLY', source_url='https://www.city.ishinomaki.lg.jp/TEST_ONLY',
        status=status, published_at=NOW-timedelta(seconds=30), received_at=NOW,
        valid_until=NOW+timedelta(hours=1), restrictions=('TEST_ONLY upstairs access restriction',))
    return m.OpeningObservation(**(values|extra))


def test_open_claim_has_original_clocks_restrictions_and_cannot_authorize_movement():
    m=module(); reg=registration(m); obs=observation(m)
    value=m.project_opening(reg,(obs,),NOW)[0]
    assert value.status.value=='OPEN'
    assert value.expires_at==obs.published_at+timedelta(seconds=300)
    assert value.restrictions==obs.restrictions and value.evidence_ids==('TEST_REPORT',)
    assert value.safe_location_verified is False and value.route_authorized is False
    assert m.project_opening(reg,(obs,),obs.published_at+timedelta(seconds=300))[0].status.value=='UNKNOWN'


def test_closed_revision_does_not_get_overwritten_by_late_old_open_report():
    m=module(); old=observation(m); closed=observation(m,'CLOSED',id='TEST_CLOSED',published_at=NOW)
    for reports in ((old,closed),(closed,old)):
        assert m.project_opening(registration(m),reports,NOW)[0].status.value=='CLOSED'
    conflict=observation(m,'OPEN',id='TEST_CONFLICT',published_at=NOW)
    assert m.project_opening(registration(m),(closed,conflict),NOW)[0].reason=='CONFLICT'


@pytest.mark.parametrize('extra',[{'area_id':'JP-MUNI-13101'},{'source_key':'other'},
    {'destination_id':'gsi-UNMAPPED'},{'source_url':'https://example.com/untrusted'},
    {'published_at':NOW+timedelta(seconds=1)},{'received_at':NOW+timedelta(seconds=1)}])
def test_scope_identity_authority_and_future_claims_fail_closed(extra):
    m=module()
    with pytest.raises(ValueError): m.project_opening(registration(m),(observation(m,**extra),),NOW)


def test_unconfigured_read_endpoint_does_not_create_session_or_accept_opening_writes():
    app=create_app(); client=TestClient(app)
    response=client.get('/api/reference/place-opening/04202')
    assert response.status_code==200
    value=response.json()
    assert value['source_status']=='UNCONFIGURED' and value['records']==[]
    assert value['area_id']=='JP-MUNI-04202' and value['route_authorized'] is False
    assert client.get('/api/reference/place-opening/99999').status_code==404
    assert client.post('/api/reference/place-opening/04202',json={'status':'OPEN'}).status_code==405


def test_adapter_failure_and_review_expiry_do_not_reuse_open_records():
    m=module(); reg=registration(m)
    class FixtureAdapter:
        authority=reg
        def fetch(self,now):
            return (observation(m),)
    store=m.PlaceOpeningStore(adapters={'04202':FixtureAdapter()},clock=lambda:NOW)
    assert store.get('04202').records[0].status.value=='OPEN'
    class FailingAdapter(FixtureAdapter):
        def fetch(self,now): raise OSError('TEST_ONLY disconnect')
    store.adapters['04202']=FailingAdapter()
    assert store.get('04202').source_status=='FAILED' and store.get('04202').records==()
    stale=reg.model_copy(update={'review_due_at':NOW})
    assert m.project_opening(stale,(observation(m),),NOW)[0].reason=='AUTHORITY_REVIEW_EXPIRED'


def test_over_capacity_or_malformed_adapter_batches_are_rejected_without_truncation():
    m=module(); reg=registration(m)
    with pytest.raises(ValueError): m.project_opening(reg,tuple(observation(m,id=f'TEST{i}') for i in range(65)),NOW)
    with pytest.raises(ValueError): m.project_opening(reg,({'status':'OPEN'},),NOW)
