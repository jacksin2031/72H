"""Build-only GSI CSV and reviewed sparse-flag GeoJSON normalization.

GeoJSON snapshot identifiers never stand in for the absent official common ID.
https://www.gsi.go.jp/common/000190664.pdf page 3 specifies omitted disaster
properties as not designated. Null is not that encoding and stays unknown.
"""
import csv
import hashlib
import io
import json
import math
import re

HAZARDS={'flood':'洪水','landslide':'崖崩れ、土石流及び地滑り','storm_surge':'高潮',
    'earthquake':'地震','tsunami':'津波','large_fire':'大規模な火事','inland_flood':'内水氾濫','volcano':'火山現象'}


def encoded(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def coordinates(lng,lat):
    if isinstance(lng,bool) or isinstance(lat,bool) or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in (lng,lat)):
        raise ValueError('Invalid GSI coordinates')
    if not (-180<=lng<=180 and -90<=lat<=90):
        raise ValueError('Out-of-range GSI coordinates')
    return float(lng),float(lat)


def text(value,max_length,required=False):
    if value is None and not required: return ''
    if not isinstance(value,str) or len(value)>max_length or (required and not value.strip()):
        raise ValueError('Invalid GSI text field')
    return value.strip()


def base(*,kind,source_id,name,address,lng,lat,notes):
    if kind not in ('EMERGENCY_SITE','SHELTER'): raise ValueError('Unknown GSI role')
    lng,lat=coordinates(lng,lat)
    return dict(kind=kind,source_id=source_id,name=text(name,240,True),address=text(address,1000,True),
        lng=lng,lat=lat,notes=text(notes,4000),open_status='UNKNOWN')


def classifications(fields,kind,geo=False):
    statuses={}; states={}; raw_values={}
    for index,(key,column) in enumerate(HAZARDS.items(),1):
        column=f'disaster{index}' if geo else column
        raw=fields.get(column)
        if kind=='SHELTER' or (column in fields and raw is None) or (not geo and column not in fields):
            status,state='UNKNOWN','MISSING_OR_NULL'
        elif geo and column not in fields:
            status,state='NOT_DESIGNATED','SCHEMA_ABSENT_NOT_DESIGNATED'
        elif (geo and type(raw) is int and raw==1) or (not geo and isinstance(raw,str) and raw.strip()=='1'):
            status,state='DESIGNATED','EXPLICIT_ONE'
        elif not geo and isinstance(raw,str) and raw.strip()=='':
            status,state='NOT_DESIGNATED','EXPLICIT_BLANK'
        else: raise ValueError('Unexpected GSI designation encoding')
        statuses[key]=status; states[key]=state; raw_values[key]=None if kind=='SHELTER' else raw
    return dict(hazards=statuses,hazard_source_states=states,hazard_raw_values=raw_values)


def normalize_csv(body,*,kind,source_id,municipality):
    if len(body)>4_000_000 or not re.fullmatch(r'\d{5}',municipality): raise ValueError('GSI CSV capacity/partition invalid')
    reader=csv.DictReader(io.StringIO(body.decode('utf-8-sig'),newline=''))
    if not {'共通ID','施設・場所名','住所','緯度','経度'}.issubset(reader.fieldnames or []): raise ValueError('GSI CSV schema mismatch')
    records=[]; seen=set()
    for row in reader:
        if len(records)>=5000 or None in row: raise ValueError('GSI CSV row capacity/schema mismatch')
        common_id=text(row['共通ID'],88,True)
        if not re.fullmatch(r'[A-Za-z0-9_-]+',common_id) or common_id in seen: raise ValueError('Duplicate/invalid common ID')
        seen.add(common_id)
        record=base(kind=kind,source_id=source_id,name=row['施設・場所名'],address=row['住所'],
            lng=float(row['経度']),lat=float(row['緯度']),notes=row.get('備考'))
        flag=row.get('指定避難所との住所同一' if kind=='EMERGENCY_SITE' else '指定緊急避難場所との住所同一')
        if flag not in (None,'','1'): raise ValueError('Invalid same-address flag')
        records.append(record|classifications(row,kind)|dict(id=f'{kind.lower()}:{common_id}',common_id=common_id,
            identity_kind='OFFICIAL_COMMON_ID_PER_ROLE',municipality_code=municipality,source_format='CSV',
            other_role_same_address=None if flag is None else flag=='1',
            acceptance=text(row.get('受入対象者'),1000),necessary_matters=text(row.get('その他市町村長が必要と認める事項'),2000)))
    return records


def normalize_geojson(body,*,kind,source_id):
    if len(body)>1_000_000: raise ValueError('GSI GeoJSON capacity exceeded')
    value=json.loads(body)
    if not isinstance(value,dict) or value.get('type')!='FeatureCollection' or not isinstance(value.get('features'),list) or len(value['features'])>4096:
        raise ValueError('GSI GeoJSON collection invalid')
    snapshot=hashlib.sha256(body).hexdigest(); records=[]
    for index,feature in enumerate(value['features']):
        if not isinstance(feature,dict) or feature.get('type')!='Feature': raise ValueError('Invalid GSI feature')
        geometry=feature.get('geometry'); p=feature.get('properties')
        if not isinstance(geometry,dict) or geometry.get('type')!='Point' or not isinstance(p,dict): raise ValueError('GSI Point schema mismatch')
        point=geometry.get('coordinates')
        if not isinstance(point,list) or len(point)!=2: raise ValueError('Invalid GSI Point coordinate')
        record=base(kind=kind,source_id=source_id,name=p.get('name'),address=p.get('address'),lng=point[0],lat=point[1],notes=p.get('remarks'))
        records.append(record|classifications(p,kind,True)|dict(id=f'geo:{snapshot}:{index}',common_id=None,
            identity_kind='SNAPSHOT_FEATURE_ONLY',municipality_code=None,source_format='GeoJSON',other_role_same_address=None,
            acceptance=text(p.get('accept'),1000),necessary_matters=text(p.get('necessary_matters'),2000)))
    return records


def catalog_delta(old,new):
    before={p['id']:p for p in old}; after={p['id']:p for p in new}
    if len(before)!=len(old) or len(after)!=len(new): raise ValueError('Duplicate catalog identity')
    return dict(authority='CATALOG_SNAPSHOT_DIFF_ONLY',absent_in_new_snapshot=sorted(before.keys()-after.keys()),
        added=sorted(after.keys()-before.keys()),changed=sorted(k for k in before.keys()&after.keys() if before[k]!=after[k]))
