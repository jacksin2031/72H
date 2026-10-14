import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pin=JSON.parse(readFileSync(join(root,'lib/jma-intensity-regions-pin.json'),'utf8'));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
if(pin.path!=='/hazards/jma-intensity-regions-v1/manifest.json')throw Error('Unexpected regional manifest path');
const raw=readFileSync(join(root,'public',pin.path));
if(sha(raw)!==pin.sha256)throw Error('Regional manifest integrity failure');
const manifest=JSON.parse(raw);
if(manifest.geometry_version!=='20240520'||manifest.code_table_version!=='20261007'||manifest.assets.length>4
 ||Object.keys(manifest.codes).length!==188||manifest.assets.reduce((n,a)=>n+a.bytes,0)>32000000)throw Error('Regional version/capacity mismatch');
const features=[];
for(const a of manifest.assets){
 if(!/^\/hazards\/jma-intensity-regions-v1\/regions-[0-3]\.geojson$/.test(a.path)||a.bytes>16000000)throw Error('Invalid regional asset path/capacity');
 const bytes=readFileSync(join(root,'public',a.path));
 if(bytes.length!==a.bytes||sha(bytes)!==a.sha256)throw Error('Regional asset integrity failure');
 features.push(...JSON.parse(bytes).features);
}
if(features.length!==manifest.included_count||new Set(features.map(f=>f.properties.code)).size!==features.length
 ||features.some(f=>!['Polygon','MultiPolygon'].includes(f.geometry.type)||manifest.codes[f.properties.code]!==f.properties.name))throw Error('Regional geometry identity mismatch');
