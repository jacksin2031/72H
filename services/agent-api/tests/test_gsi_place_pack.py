"""Run the real build-only normalizers against hand-checked synthetic records."""
import importlib
import importlib.util
import json
from pathlib import Path
import sys
import subprocess
import hashlib

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts'))


def module():
    assert importlib.util.find_spec('gsi_places') is not None, 'GSI GeoJSON normalizer missing'
    return importlib.import_module('gsi_places')


def geo(properties=None, coordinates=None):
    return json.dumps({'type':'FeatureCollection','features':[{'type':'Feature',
        'properties':properties or {'name':'TEST school','address':'TEST address','remarks':None,'disaster5':1},
        'geometry':{'type':'Point','coordinates':coordinates or [141.3,38.4]}}]}).encode()


def csv_body(id='TEST01',tsunami='1'):
    return ('共通ID,施設・場所名,住所,緯度,経度,津波,地震,指定避難所との住所同一\n'
        f'{id},TEST school,TEST address,38.4,141.3,{tsunami},,1\n').encode()


def test_geojson_sparse_schema_absence_differs_from_null_and_no_stable_identity_is_invented():
    m=module(); rows=m.normalize_geojson(geo(),kind='EMERGENCY_SITE',source_id='TEST-GEO')
    assert rows[0]['hazards']['tsunami']=='DESIGNATED'
    assert rows[0]['hazards']['earthquake']=='NOT_DESIGNATED'
    assert rows[0]['hazard_source_states']['earthquake']=='SCHEMA_ABSENT_NOT_DESIGNATED'
    null=m.normalize_geojson(geo({'name':'TEST','address':'TEST','disaster4':None}),kind='EMERGENCY_SITE',source_id='TEST')[0]
    assert null['hazards']['earthquake']=='UNKNOWN'
    assert rows[0]['common_id'] is None and rows[0]['identity_kind']=='SNAPSHOT_FEATURE_ONLY'
    assert rows[0]['municipality_code'] is None
    assert rows[0]['open_status']=='UNKNOWN'
    assert rows[0]['hazard_raw_values']['tsunami']==1
    assert m.normalize_geojson(geo({'name':'TEST shelter','address':'TEST address','disaster5':1}),kind='SHELTER',source_id='TEST-GEO')[0]['hazards']['tsunami']=='UNKNOWN'


def test_csv_retains_role_ids_blank_missing_values_and_official_same_address_flag():
    m=module(); rows=m.normalize_csv(csv_body(),kind='EMERGENCY_SITE',source_id='TEST-CSV',municipality='04202')
    assert rows[0]['common_id']=='TEST01' and rows[0]['id']=='emergency_site:TEST01'
    assert rows[0]['hazards']['earthquake']=='NOT_DESIGNATED' and rows[0]['hazards']['flood']=='UNKNOWN'
    assert rows[0]['other_role_same_address'] is True
    assert rows[0]['hazard_source_states']['earthquake']=='EXPLICIT_BLANK'
    shelters=m.normalize_csv(csv_body(),kind='SHELTER',source_id='TEST-CSV',municipality='04202')
    assert shelters[0]['id']=='shelter:TEST01' and shelters[0]['hazards']['tsunami']=='UNKNOWN'


@pytest.mark.parametrize('coordinates',[[38.4,141.3],[181,38.4],[141.3,91],[True,38.4]])
def test_wrong_axis_range_or_boolean_coordinates_are_rejected(coordinates):
    with pytest.raises(ValueError): module().normalize_geojson(geo(coordinates=coordinates),kind='EMERGENCY_SITE',source_id='TEST')


def test_bad_schema_duplicate_ids_and_capacity_do_not_publish_partial_pack():
    m=module()
    with pytest.raises(ValueError): m.normalize_geojson(b'{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[]},"properties":{}}]}',kind='EMERGENCY_SITE',source_id='TEST')
    with pytest.raises(ValueError): m.normalize_geojson(geo({'name':'TEST','address':'TEST','disaster5':0}),kind='EMERGENCY_SITE',source_id='TEST')
    with pytest.raises(ValueError): m.normalize_geojson(b'x'*1_000_001,kind='EMERGENCY_SITE',source_id='TEST')
    with pytest.raises(ValueError): m.normalize_csv(csv_body()+csv_body().split(b'\n')[1]+b'\n',kind='EMERGENCY_SITE',source_id='TEST',municipality='04202')


def test_snapshot_removals_do_not_assert_official_closure_or_merge_different_ids():
    m=module(); old=m.normalize_csv(csv_body('OLD'),kind='EMERGENCY_SITE',source_id='TEST',municipality='04202')
    new=m.normalize_csv(csv_body('NEW'),kind='EMERGENCY_SITE',source_id='TEST',municipality='04202')
    delta=m.catalog_delta(old,new)
    assert delta['absent_in_new_snapshot']==['emergency_site:OLD']
    assert delta['added']==['emergency_site:NEW'] and delta['authority']=='CATALOG_SNAPSHOT_DIFF_ONLY'
    assert new[0]['open_status']=='UNKNOWN'


def test_actual_official_sample_matches_content_but_not_common_id_or_exact_coordinate_precision():
    retained=Path.home()/'AppData/Local/Temp/72h-gsi-shelter-research'
    if not retained.exists(): pytest.skip('Retained source research files not installed')
    m=module()
    emergency=m.normalize_csv((retained/'04202_2.csv').read_bytes(),kind='EMERGENCY_SITE',source_id='actual-emergency',municipality='04202')
    shelters=m.normalize_csv((retained/'04202_1.csv').read_bytes(),kind='SHELTER',source_id='actual-shelter',municipality='04202')
    points=m.normalize_geojson((retained/'skhb05_10_914_393.geojson').read_bytes(),kind='EMERGENCY_SITE',source_id='actual-geo')
    assert len(emergency)==300 and len(shelters)==95 and len(points)==85
    e=next(r for r in emergency if r['common_id']=='E0420200002201')
    s=next(r for r in shelters if r['common_id']=='E0420200002111')
    sample=next(r for r in points if r['name']=='渡波中学校' and r['address']=='宮城県石巻市さくら町4-1')
    assert e['name']==s['name']==sample['name']
    assert e['hazards']==sample['hazards']
    assert e['common_id']!=s['common_id'] and sample['common_id'] is None
    assert abs(e['lat']-sample['lat'])<0.000001 and e['lat']!=sample['lat']


def test_partition_builder_pins_sources_and_keeps_unavailable_tile_distinct(tmp_path):
    script=Path(__file__).resolve().parents[3]/'scripts/build_gsi_place_pack.py'
    assert script.exists(), 'GSI partition builder missing'
    files={'04202_2.csv':csv_body(),'04202_1.csv':csv_body('S01'),
        'skhb05_10_914_393.geojson':geo(),'sih_10_914_393.geojson':geo({'name':'TEST shelter','address':'TEST address'}),
        'publicHistoryListData.csv':b'04202,TEST,2017-02-22,2026-06-12,,\n',
        'skhb04_10_914_393.http-response.txt':b'TEST_ONLY 404'}
    receipts={}
    for name,raw in files.items():
        (tmp_path/name).write_bytes(raw)
        receipts[name]={'sha256':hashlib.sha256(raw).hexdigest(),'retrieved_at':'2026-10-12T10:00:00Z','status':404 if name.endswith('.txt') else 200}
    (tmp_path/'receipts.json').write_text(json.dumps(receipts))
    output=tmp_path/'output'
    command=[sys.executable,str(script),'--source-dir',str(tmp_path),'--receipts',str(tmp_path/'receipts.json'),
        '--reviewed-at','2026-10-12T10:30:00Z','--output',str(output),'--pin-output',str(tmp_path/'pin.json')]
    result=subprocess.run(command,capture_output=True,text=True)
    assert result.returncode==0,result.stderr
    manifest=json.loads((output/'manifest.json').read_text())
    assert manifest['geojson_availability']['earthquake']=='UNAVAILABLE_404'
    assert manifest['database_updated_on']=='2026-06-12' and manifest['designation_date'] is None
    assert manifest['catalog_count']==2 and manifest['opening_feed']=='UNCONFIGURED'
    pin=json.loads((tmp_path/'pin.json').read_text())
    assert pin['sha256']==hashlib.sha256((output/'manifest.json').read_bytes()).hexdigest()
    # A tampered receipt must leave the previously published manifest intact.
    old=(output/'manifest.json').read_bytes(); (tmp_path/'04202_2.csv').write_bytes(b'corrupt')
    assert subprocess.run(command,capture_output=True).returncode!=0
    assert (output/'manifest.json').read_bytes()==old
