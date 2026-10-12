import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pin=JSON.parse(readFileSync(join(root,'lib/jma-forecast-lines-pin.json'),'utf8'));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
if(pin.path!=='/hazards/jma-forecast-lines-v1/manifest.json')throw Error('Unexpected forecast line manifest path');
const raw=readFileSync(join(root,'public',pin.path));
if(sha(raw)!==pin.sha256)throw Error('Forecast line manifest integrity failure');
const manifest=JSON.parse(raw),asset=manifest.geometry;
if(manifest.geometry_version!=='20240520'||manifest.code_table_version!=='20261007'
 ||asset.path!=='/hazards/jma-forecast-lines-v1/coastal-lines.geojson'||asset.bytes>16000000)throw Error('Forecast line version/capacity mismatch');
const bytes=readFileSync(join(root,'public',asset.path));
if(bytes.length!==asset.bytes||sha(bytes)!==asset.sha256)throw Error('Forecast line asset integrity failure');
const data=JSON.parse(bytes);
if(data.features.length!==66||data.features.some(f=>f.geometry.type!=='MultiLineString'))throw Error('Unexpected forecast line geometry');
// No downloads, repinning or pre-cache expansion at build time.
