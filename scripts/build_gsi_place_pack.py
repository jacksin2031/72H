"""Build a bounded Ishinomaki designation partition from retained official inputs.

No network, GIS dependencies, guessed identity joins or opening inference.
Review/receipt/database-update/designation clocks retain different meanings.
"""
import argparse
import csv
from datetime import datetime,timedelta,timezone
import hashlib
import io
import json
from pathlib import Path
from gsi_places import encoded,normalize_csv,normalize_geojson,catalog_delta

ROOT=Path(__file__).resolve().parents[1]
PREFIX='/hazards/gsi-ishinomaki-places-v1'
SOURCES={
    '04202_2.csv':('csv-emergency','https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/04202_2.csv'),
    '04202_1.csv':('csv-shelter','https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/04202_1.csv'),
    'skhb05_10_914_393.geojson':('geo-tsunami','https://cyberjapandata.gsi.go.jp/xyz/skhb05/10/914/393.geojson'),
    'sih_10_914_393.geojson':('geo-shelter','https://cyberjapandata.gsi.go.jp/xyz/sih/10/914/393.geojson'),
    'publicHistoryListData.csv':('gsi-update-list','https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/publicHistoryCSV/publicHistoryListData.csv'),
    'skhb04_10_914_393.http-response.txt':('geo-earthquake','https://cyberjapandata.gsi.go.jp/xyz/skhb04/10/914/393.geojson'),
}


def instant(value):
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None: raise ValueError('Time offset missing')
    return parsed


def build(source_dir,receipts,reviewed_at,output,pin_output,previous_catalog=None):
    reviewed=instant(reviewed_at); inputs={}; sources=[]
    for filename,(key,url) in SOURCES.items():
        raw=(source_dir/filename).read_bytes(); receipt=receipts[filename]
        expected_status=404 if filename.endswith('.txt') else 200
        if len(raw)>4_000_000 or hashlib.sha256(raw).hexdigest()!=receipt['sha256'] or receipt['status']!=expected_status:
            raise ValueError('Official input receipt mismatch')
        if instant(receipt['retrieved_at'])>reviewed: raise ValueError('Review predates source retrieval')
        inputs[filename]=raw
        sources.append(dict(id=key,url=url,raw_sha256=receipt['sha256'],bytes=len(raw),retrieved_at=receipt['retrieved_at'],
            http_status=expected_status,published_at=None,updated_at=None,
            scope='MUNICIPAL_CSV' if filename.startswith('04202') else 'TILE_10_914_393' if filename.startswith(('skhb','sih')) else 'PUBLIC_DATABASE_METADATA'))
    metadata=list(csv.reader(io.StringIO(inputs['publicHistoryListData.csv'].decode('utf-8-sig'))))
    matches=[r for r in metadata if r and r[0]=='04202']
    if len(matches)!=1 or len(matches[0])<4: raise ValueError('Municipality update metadata unavailable')
    published,updated=matches[0][2:4]
    for value in (published,updated): datetime.strptime(value,'%Y-%m-%d')
    catalog=normalize_csv(inputs['04202_2.csv'],kind='EMERGENCY_SITE',source_id='csv-emergency',municipality='04202')
    catalog+=normalize_csv(inputs['04202_1.csv'],kind='SHELTER',source_id='csv-shelter',municipality='04202')
    groups={'catalog':catalog,
        'geo-tsunami':normalize_geojson(inputs['skhb05_10_914_393.geojson'],kind='EMERGENCY_SITE',source_id='geo-tsunami'),
        'geo-shelter':normalize_geojson(inputs['sih_10_914_393.geojson'],kind='SHELTER',source_id='geo-shelter')}
    assets=[]; content={}
    for kind,records in groups.items():
        if len({r['id'] for r in records})!=len(records): raise ValueError('Duplicate place identity')
        raw=encoded(records); sha=hashlib.sha256(raw).hexdigest(); name=f'{kind}-{sha[:16]}.json'
        if len(raw)>4_000_000: raise ValueError('Place asset capacity exceeded')
        assets.append(dict(kind=kind,path=f'{PREFIX}/{name}',sha256=sha,bytes=len(raw),record_count=len(records)))
        content[name]=raw
    old=json.loads(previous_catalog.read_bytes()) if previous_catalog else []
    manifest=dict(schema_version=1,dataset_id='gsi-ishinomaki-places-v1',area_id='JP-MUNI-04202',municipality_code='04202',
        reviewed_at=reviewed_at,review_due_at=(reviewed+timedelta(days=90)).isoformat(),coverage='PARTIAL',
        catalog_published_on=published,database_updated_on=updated,designation_date=None,
        geojson_schema='GSI_SPARSE_DISASTER_FLAGS_V1',identity_crosswalk='UNAVAILABLE',
        geojson_availability={'tsunami':'AVAILABLE','shelter':'AVAILABLE','earthquake':'UNAVAILABLE_404'},
        catalog_count=len(catalog),sources=sources,assets=assets,opening_feed='UNCONFIGURED',
        previous_catalog_sha256=hashlib.sha256(previous_catalog.read_bytes()).hexdigest() if previous_catalog else None,
        catalog_delta=catalog_delta(old,catalog),
        route_authorized=False,safe_location_verified=False,
        attribution='出典：国土地理院 指定緊急避難場所・指定避難所データを加工。',
        license_url='https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html',
        schema_url='https://cyberjapandata.gsi.go.jp/development/ichiran.html',
        sparse_schema_url='https://www.gsi.go.jp/common/000190664.pdf',
        limitations=['Public consented catalog only; per-record effective/updated dates unknown.',
            'GeoJSON tile is a partial geographic shard, not a municipality-wide catalog.',
            'No stable CSV/GeoJSON or municipal-opening crosswalk; same name/address does not establish identity.',
            'Catalog absence is not closure or an official withdrawal notice.',
            'Designation, open status, inundation and road references do not authorize movement.'])
    raw=encoded(manifest)
    if len(raw)>128_000: raise ValueError('Place manifest capacity exceeded')
    # Validate all sources/records first. Publish hashed assets, then replace only
    # the manifest/pin; no old/new union or partial network-derived release.
    output.mkdir(parents=True,exist_ok=True)
    for name,value in content.items(): (output/name).write_bytes(value)
    temp=output/'manifest.json.pending'; temp.write_bytes(raw); temp.replace(output/'manifest.json')
    pin_output.parent.mkdir(parents=True,exist_ok=True)
    pin_output.write_bytes(encoded(dict(path=f'{PREFIX}/manifest.json',sha256=hashlib.sha256(raw).hexdigest())))
    print(json.dumps(dict(catalog=len(catalog),geo_tsunami=len(groups['geo-tsunami']),geo_shelter=len(groups['geo-shelter']),bytes=sum(len(v) for v in content.values()))))


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--source-dir',type=Path,required=True); p.add_argument('--receipts',type=Path,required=True)
    p.add_argument('--reviewed-at',required=True); p.add_argument('--previous-catalog',type=Path)
    p.add_argument('--output',type=Path,default=ROOT/'apps/web/public/hazards/gsi-ishinomaki-places-v1')
    p.add_argument('--pin-output',type=Path,default=ROOT/'apps/web/lib/gsi-place-pin.json')
    a=p.parse_args(); build(a.source_dir,json.loads(a.receipts.read_bytes()),a.reviewed_at,a.output,a.pin_output,a.previous_catalog)
