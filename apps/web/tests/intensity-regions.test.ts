import {expect,it,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {webcrypto} from 'node:crypto';
import {regionalMaxima,loadIntensityRegionPack,type IntensityRegionPack} from '../lib/intensity-regions';
import {mapFixture,now,manifest} from './fixtures/disaster-map';

const pack:IntensityRegionPack={manifest:{geometry_version:'20240520',code_table_version:'20261007',reviewed_at:manifest.reviewed_at,review_due_at:manifest.review_due_at,codes:{'100':'石狩地方北部'}},features:[{
 type:'Feature',properties:{code:'100',name:'石狩地方北部',anchor:[141,43]},geometry:{type:'Polygon',coordinates:[[[141,43],[142,43],[142,44],[141,43]]]},
}]};
afterEach(()=>vi.unstubAllGlobals());
function observed(){const data=mapFixture(),r=data.reports[0];r.bulletin.product='VXSE53';r.forecast_areas=[];
 r.observations=[{granularity:'REGION',measurement:'MAXIMUM',code:'100',name:'石狩地方北部',intensity:'5+',prefecture_code:'01'},
  {granularity:'STATION',measurement:'MEASURED',code:'0123500',name:'石狩市花川',intensity:'4',prefecture_code:'01'},
  {granularity:'PREFECTURE',measurement:'MAXIMUM',code:'01',name:'北海道',intensity:'7',prefecture_code:'01'}];
 return data;}
it('maps only exact regional codes/names as scope maxima, never prefecture/station points',()=>{
 const data=observed(),items=regionalMaxima(pack,data,true,now);
 expect(items).toHaveLength(1);expect(items[0]).toMatchObject({code:'100',intensity:'5+',state:'RECENT_REFERENCE',scope:'REGION_MAXIMUM_NOT_POINT_MEASUREMENT'});
 expect(items[0].report_ids).toEqual([data.reports[0].bulletin.report_id]);expect(items[0]).not.toHaveProperty('coordinates');
 data.reports[0].observations[0].name='Wrong region';expect(regionalMaxima(pack,data,true,now)).toEqual([]);
});
it('keeps old intensity separate from recent reference and preserves original timestamps',()=>{
 const data=observed(),old=structuredClone(data.reports[0]);old.bulletin.group_id='c'.repeat(24);old.bulletin.report_id=`${'c'.repeat(24)}--${'b'.repeat(24)}`;
 old.bulletin.lifecycle='STALE';old.observations[0].intensity='7';data.reports.push(old);
 expect(regionalMaxima(pack,data,true,now)[0].intensity).toBe('5+');
 expect(regionalMaxima(pack,data,false,now)[0].state).toBe('ARCHIVED_REFERENCE');
 expect(regionalMaxima(pack,data,true,now+900000)[0].state).toBe('ARCHIVED_REFERENCE');
 expect(regionalMaxima(pack,data,false,now)[0].issued_at).toContain(old.bulletin.issued_at);
});
it('unknown measurement, conflict, old code version or missing geometry never produces a current value',()=>{
 const data=observed();data.reports[0].observations[0].intensity=null;
 expect(regionalMaxima(pack,data,true,now)[0]).toMatchObject({state:'UNKNOWN',intensity:null});
 data.reports[0].bulletin.lifecycle='CONFLICT';expect(regionalMaxima(pack,data,true,now)[0].state).toBe('UNKNOWN');
 expect(regionalMaxima({...pack,manifest:{...pack.manifest,code_table_version:'20250101'}},data,true,now)).toEqual([]);
 expect(regionalMaxima({...pack,features:[]},data,true,now)).toEqual([]);
 data.reports[0].bulletin.issued_at='2011-03-11T05:46:00Z';expect(regionalMaxima(pack,data,false,now)).toEqual([]);
 expect(regionalMaxima(pack,observed(),true,Date.parse(manifest.review_due_at))).toEqual([]);
});
it('verifies the actual regional pack and discloses every missing/unassigned source geometry',async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(readFileSync(resolve(__dirname,'../public'+path)))));
 const actual=await loadIntensityRegionPack();expect(actual.features).toHaveLength(181);expect(Object.keys(actual.manifest.codes)).toHaveLength(188);
 expect(actual.manifest.excluded_geometry.filter(x=>x.code!==null)).toHaveLength(7);
 expect(actual.manifest.excluded_geometry.filter(x=>x.code===null)).toHaveLength(6);
 expect(actual.features.every(f=>['Polygon','MultiPolygon'].includes(f.geometry.type))).toBe(true);
 expect(actual.manifest.sources.every(s=>s.url.startsWith('https://'))).toBe(true);
},20000);
it('reports the strongest of two valid reference bulletins with both original source bindings',()=>{
 const data=observed(),other=structuredClone(data.reports[0]);other.bulletin.group_id='c'.repeat(24);other.bulletin.report_id=`${'c'.repeat(24)}--${'b'.repeat(24)}`;
 other.observations[0].intensity='6-';data.reports.push(other);
 const value=regionalMaxima(pack,data,true,now)[0];expect(value.intensity).toBe('6-');expect(value.report_ids).toHaveLength(2);expect(value.issued_at).toHaveLength(2);
 other.observations[0].intensity=null;expect(regionalMaxima(pack,data,true,now)[0].state).toBe('UNKNOWN');
});
