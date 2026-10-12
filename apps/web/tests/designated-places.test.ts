import {expect,it,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

afterEach(()=>vi.unstubAllGlobals());
async function library(){
  const value=await import('../lib/designated-places').catch(()=>null);
  expect(value,'GSI partition client missing').not.toBeNull();return value!;
}
const now=Date.parse('2026-10-12T11:00:00Z');
it('loads real pinned CSV identities and GeoJSON snapshot references without guessing an identity join',async()=>{
  const m=await library();vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(readFileSync(resolve('public'+path)))));
  const pack=await m.loadDesignatedPlaces();
  expect(pack.catalog).toHaveLength(395);expect(pack.geoTsunami).toHaveLength(85);expect(pack.geoShelter).toHaveLength(74);
  const e=pack.catalog.find(p=>p.common_id==='E0420200002201')!;
  const s=pack.catalog.find(p=>p.common_id==='E0420200002111')!;
  expect(e.id).not.toBe(s.id);expect(e.kind).toBe('EMERGENCY_SITE');expect(s.kind).toBe('SHELTER');
  expect(m.selectDesignationPlaces(pack,'CSV','tsunami').places.some(p=>p.id===s.id)).toBe(false);
  expect(m.selectDesignationPlaces(pack,'GeoJSON','earthquake').reason).toBe('UNAVAILABLE_404');
  expect(pack.geoTsunami.every(p=>p.common_id===null&&p.open_status==='UNKNOWN')).toBe(true);
});
it('rejects a corrupt catalog rather than retaining an older place or publishing partial assets',async()=>{
  const m=await library();vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(path.includes('/catalog-')?'[]':readFileSync(resolve('public'+path)))));
  await expect(m.loadDesignatedPlaces()).rejects.toThrow();
});
it('opening expires by publication policy, never grants movement and cannot attach to unkeyed GeoJSON',async()=>{
  const m=await library();
  const record={destination_id:'emergency_site:TEST',status:'OPEN',reason:'VERIFIED',source_key:'TEST_ONLY',source_url:'https://www.city.ishinomaki.lg.jp/TEST_ONLY',
    published_at:new Date(now-30_000).toISOString(),received_at:new Date(now).toISOString(),expires_at:new Date(now+3_600_000).toISOString(),
    restrictions:['TEST restriction'],evidence_ids:['TEST report'],safe_location_verified:false,route_authorized:false};
  const value=m.openingSchema.parse({mode:'LIVE_REFERENCE',area_id:'JP-MUNI-04202',generated_at:new Date(now).toISOString(),fetched_at:new Date(now).toISOString(),
    source_status:'AVAILABLE',records:[record],authority:'REFERENCE_ONLY',safe_location_verified:false,route_authorized:false});
  const place={id:'emergency_site:TEST',identity_kind:'OFFICIAL_COMMON_ID_PER_ROLE' as const,municipality_code:'04202'};
  expect(m.placeOpening(place,value,true,now).status).toBe('OPEN');
  expect(m.placeOpening(place,value,true,now+270_000).status).toBe('UNKNOWN');
  expect(m.placeOpening(place,value,true,now+270_000).record?.published_at).toBe(record.published_at);
  expect(m.placeOpening(place,value,false,now).record?.source_url).toBe(record.source_url);
  expect(m.placeOpening(place,value,false,now).status).toBe('UNKNOWN');
  expect(m.placeOpening({...place,identity_kind:'SNAPSHOT_FEATURE_ONLY'},value,true,now).status).toBe('UNKNOWN');
  expect(m.placeOpening({...place,municipality_code:'13101'},value,true,now).status).toBe('UNKNOWN');
  expect(m.placeOpening(place,{...value,source_status:'FAILED'},true,now).status).toBe('UNKNOWN');
});
