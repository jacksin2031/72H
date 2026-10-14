import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const pin=JSON.parse(readFileSync(join(root,'lib/gsi-place-pin.json'),'utf8'));
if(pin.path!=='/hazards/gsi-ishinomaki-places-v1/manifest.json')throw Error('Unexpected designation manifest path');
const raw=readFileSync(join(root,'public',pin.path));
if(raw.length>128000||sha(raw)!==pin.sha256)throw Error('Designation manifest integrity failure');
const m=JSON.parse(raw);
if(m.area_id!=='JP-MUNI-04202'||m.geojson_schema!=='GSI_SPARSE_DISASTER_FLAGS_V1'||m.assets.length!==3
 ||m.assets.reduce((n,a)=>n+a.bytes,0)>4000000||m.safe_location_verified!==false||m.route_authorized!==false)throw Error('Invalid designation partition');
for(const a of m.assets){
 if(!/^\/hazards\/gsi-ishinomaki-places-v1\/(catalog|geo-tsunami|geo-shelter)-[a-f0-9]{16}\.json$/.test(a.path)||a.bytes>4000000)throw Error('Invalid designation asset path/capacity');
 const value=readFileSync(join(root,'public',a.path));
 if(value.length!==a.bytes||sha(value)!==a.sha256)throw Error('Designation asset integrity failure');
 const rows=JSON.parse(value);
 if(rows.length!==a.record_count||new Set(rows.map(p=>p.id)).size!==rows.length||rows.some(p=>p.open_status!=='UNKNOWN'
   ||(a.kind==='catalog'?p.identity_kind!=='OFFICIAL_COMMON_ID_PER_ROLE':p.common_id!==null||p.identity_kind!=='SNAPSHOT_FEATURE_ONLY')))
   throw Error('Designation identity/opening mismatch');
}
