import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {resolve} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import pin from '../lib/official-hazard-pin.json';
import {loadOfficialHazardPack,assessOfficialHazards,isTsunamiDesignated} from '../lib/official-hazards';

afterEach(()=>vi.unstubAllGlobals());
async function realPack(){
  vi.stubGlobal('crypto',webcrypto);
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
    const raw=readFileSync(resolve('public',path.slice(1)));
    return new Response(raw);
  }));
  return loadOfficialHazardPack();
}

it('loads the actual audited asset pack through the pinned manifest and every asset hash',async()=>{
  const raw=readFileSync(resolve('public',pin.path.slice(1)));
  expect(createHash('sha256').update(raw).digest('hex')).toBe(pin.sha256);
  const pack=await realPack();
  expect(pack.inundation.features.length).toBeGreaterThan(0);
  expect(pack.manifest.coverage_status).toBe('PARTIAL');
  expect(pack.coverage).toBeNull();
  expect(pack.manifest.positional_accuracy_kind).toBe('STANDARD_DEVIATION');
  expect(pack.places.some(p=>p.kind==='SHELTER')).toBe(true);
  expect(pack.places.some(isTsunamiDesignated)).toBe(true);
  expect(pack.places.every(p=>p.open_status==='UNKNOWN')).toBe(true);
  expect(pack.places.filter(p=>p.kind==='SHELTER').every(p=>Object.values(p.hazards).every(x=>x==='UNKNOWN'))).toBe(true);
});

it('keeps the actual inundation edge uncertain and an uncovered Tokyo point unknown',async()=>{
  const pack=await realPack();
  const geometry=pack.inundation.features[0].geometry;
  const [lng,lat]=geometry.type==='Polygon'?geometry.coordinates[0][0]:geometry.coordinates[0][0][0];
  const now=Date.parse(pack.manifest.reviewed_at)+1000;
  const edge=assessOfficialHazards(pack,{lng,lat,accuracy_m:0,captured_at:now,source:'MAP_POINT'},now);
  expect(edge.status).toBe('BOUNDARY_UNCERTAIN');
  expect(edge.depth_labels.length).toBeGreaterThan(0);
  // Public representative point derived from A40-22-04-0015729, not device GPS.
  const interior=assessOfficialHazards(pack,{lng:141.34844853432656,lat:38.45106824839006,accuracy_m:0,captured_at:now,source:'MAP_POINT'},now);
  expect(interior).toMatchObject({status:'BOUNDARY_UNCERTAIN',reason:'SOURCE_ACCURACY_NOT_BOUND'});
  expect(interior.depth_labels).toContain('0.3m以上 〜 0.5m未満');
  const outside=assessOfficialHazards(pack,{lng:139.7671,lat:35.6812,accuracy_m:0,captured_at:now,source:'MAP_POINT'},now);
  expect(outside.status).toBe('UNKNOWN');
  for(const result of [edge,outside])expect(result).toMatchObject({safe_location_verified:false,route_authorized:false});
});

it('rejects an altered official geometry asset even when the manifest itself is intact',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
    const raw=readFileSync(resolve('public',path.slice(1)));
    if(path.endsWith('inundation-001.geojson'))raw[100]^=1;
    return new Response(raw);
  }));
  await expect(loadOfficialHazardPack()).rejects.toThrow('integrity');
});
