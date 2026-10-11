import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Build-time only; no external requests and no authority promotion.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const path='/hazards/miyagi-ishinomaki-v1/manifest.json';
const raw=readFileSync(join(root,'public',path));
const manifest=JSON.parse(raw);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(manifest.schema_version!==1||manifest.assets.length>20)throw Error('Invalid official pack manifest');
for(const asset of manifest.assets){
  if(!/^\/hazards\/[a-z0-9/_-]+\.(json|geojson)$/.test(asset.path))throw Error('Invalid asset path');
  const bytes=readFileSync(join(root,'public',asset.path));
  if(bytes.length!==asset.bytes||sha(bytes)!==asset.sha256)throw Error('Official pack does not match its manifest');
}
writeFileSync(join(root,'lib/official-hazard-pin.json'),JSON.stringify({path,sha256:sha(raw)})+'\n');
