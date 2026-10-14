import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {resolve} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {loadJapanShelterCatalog,loadJapanShelterPrefecture,filterJapanShelters} from '../lib/japan-shelters';

afterEach(()=>vi.unstubAllGlobals());
function assets(){
  vi.stubGlobal('crypto',webcrypto);
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(readFileSync(resolve('public',path.slice(1))))));
}
it('loads a national catalog but only the chosen prefecture, retaining both designation roles',async()=>{
  assets();
  const catalog=await loadJapanShelterCatalog();
  expect(catalog.prefectures).toHaveLength(47);
  expect(catalog.total_count).toBe(catalog.shelter_count+catalog.emergency_count);
  expect(catalog.total_count).toBeGreaterThan(190000);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  const places=await loadJapanShelterPrefecture(catalog,'13');
  expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  expect(places.some(p=>p.kind==='SHELTER')).toBe(true);
  expect(places.some(p=>p.kind==='EMERGENCY_SITE')).toBe(true);
  expect(places.every(p=>p.municipality_id.startsWith('13')&&p.open_status==='UNKNOWN')).toBe(true);
  expect(places.filter(p=>p.kind==='SHELTER').every(p=>Object.values(p.hazards).every(x=>x==='UNKNOWN'))).toBe(true);
  expect(catalog.route_authorized).toBe(false);
  expect(catalog.safe_location_verified).toBe(false);
});
it('verifies every actual prefecture shard and its count against the pinned manifest',async()=>{
  assets();
  const catalog=await loadJapanShelterCatalog();
  let count=0;
  for(const pref of catalog.prefectures){
    const places=await loadJapanShelterPrefecture(catalog,pref.code);
    expect(places).toHaveLength(pref.count);
    expect(places.every(p=>p.open_status==='UNKNOWN')).toBe(true);
    count+=places.length;
  }
  expect(count).toBe(catalog.total_count);
},20000);
it('rejects changed bytes and unknown prefectures instead of exposing unverified places',async()=>{
  assets();
  const catalog=await loadJapanShelterCatalog();
  await expect(loadJapanShelterPrefecture(catalog,'99')).rejects.toThrow();
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('[]')));
  await expect(loadJapanShelterPrefecture(catalog,'13')).rejects.toThrow(/integrity|length/i);
  await expect(loadJapanShelterCatalog()).rejects.toThrow(/integrity|length/i);
});
it('filters municipality, designation role, name and tsunami applicability independently',async()=>{
  assets();
  const catalog=await loadJapanShelterCatalog();
  const places=await loadJapanShelterPrefecture(catalog,'04');
  const results=filterJapanShelters(places,{municipality:'04202',kind:'EMERGENCY_SITE',hazard:'tsunami',search:''});
  expect(results.length).toBeGreaterThan(0);
  expect(results.every(p=>p.municipality_id==='04202'&&p.kind==='EMERGENCY_SITE'&&p.hazards.tsunami==='DESIGNATED')).toBe(true);
  expect(filterJapanShelters(places,{municipality:'',kind:'SHELTER',hazard:'tsunami',search:''})).toEqual([]);
  const first=places[0];
  expect(filterJapanShelters(places,{municipality:'',kind:'ALL',hazard:'',search:first.name})).toContain(first);
});
