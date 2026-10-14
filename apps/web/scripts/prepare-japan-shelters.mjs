import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=JSON.parse(readFileSync(join(root,'lib/japan-shelter-pin.json')));
if(!/^\/shelters\/japan-v1\/manifest-[a-f0-9]{64}\.json$/.test(pin.path))throw Error('Invalid shelter catalog path');
const bytes=readFileSync(join(root,'public',pin.path));
if(hash(bytes)!==pin.sha256)throw Error('Shelter catalog integrity failure');
const catalog=JSON.parse(bytes);
if(catalog.schema_version!==1||catalog.prefectures.length!==47||catalog.route_authorized!==false||catalog.safe_location_verified!==false)throw Error('Invalid national designation catalog');
let count=0;
for(const pref of catalog.prefectures){
  if(pref.path!==`/shelters/japan-v1/${pref.code}-${pref.sha256}.json`)throw Error('Invalid prefecture asset path');
  const raw=readFileSync(join(root,'public',pref.path));
  if(raw.length!==pref.bytes||hash(raw)!==pref.sha256||JSON.parse(raw).length!==pref.count)throw Error('Shelter pack integrity/count failure');
  count+=pref.count;
}
if(count!==catalog.total_count||count!==catalog.shelter_count+catalog.emergency_count)throw Error('National designation count mismatch');
console.log(`Verified ${count} published designation records across 47 prefectures.`);
