import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {webcrypto,createHash} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {boundedText,disasterMapSchema,forecastLines,isMapReportCurrent,loadForecastLinePack} from '../lib/disaster-map';
import {mapFixture,linePack,now,manifest} from './fixtures/disaster-map';
import pin from '../lib/jma-forecast-lines-pin.json';
afterEach(()=>vi.unstubAllGlobals());
it('keeps API references, measured stations, scope maxima and source units constrained',()=>{
 const data=mapFixture();expect(disasterMapSchema.safeParse({...data,route_authorized:true}).success).toBe(false);
 expect(disasterMapSchema.safeParse({...data,reports:[...data.reports,...data.reports]}).success).toBe(false);
 expect(disasterMapSchema.safeParse({...data,sources:[data.sources[0],data.sources[0]]}).success).toBe(false);
 expect(disasterMapSchema.safeParse({...data,tsunami_code_table_version:'20250101'}).success).toBe(false);
 const r=data.reports[0],item={granularity:'CITY',measurement:'MEASURED',code:'01234',name:'Test city',intensity:'7',prefecture_code:'01'};
 expect(disasterMapSchema.safeParse({...data,reports:[{...r,bulletin:{...r.bulletin,product:'VXSE53'},forecast_areas:[],observations:[item]}]}).success).toBe(false);
});
it('matches versioned official line codes and explicit composite members only',()=>{
 const data=mapFixture(),r=data.reports[0];
 expect(forecastLines(linePack,data,true,now).features[0].properties.state).toBe('ACTIVE');
 r.forecast_areas[0]={...r.forecast_areas[0],area_code:'191',area_name:manifest.codes['191'].name};
 expect(forecastLines(linePack,data,true,now).features.map(f=>f.properties.code)).toEqual(['100','101','102']);
 r.forecast_areas[0].area_name='Wrong municipality';expect(forecastLines(linePack,data,true,now).features).toHaveLength(0);
 expect(forecastLines(linePack,data,true,now).unmapped).toEqual(['191']);
 r.forecast_areas[0].area_code='999';expect(forecastLines(linePack,data,true,now).features).toHaveLength(0);
 expect(forecastLines({...linePack,manifest:{...manifest,code_table_version:'20250101'}},data,true,now).reason).toBe('GEOMETRY_VERSION_OR_REVIEW_UNKNOWN');
});
it('never renews TTL with receipt, offline cache, incomplete recovery or future clock',()=>{
 const data=mapFixture(),r=data.reports[0];
 expect(isMapReportCurrent(data,r,true,now)).toBe(true);
 expect(forecastLines(linePack,data,false,now).features[0].properties.state).toBe('STALE');
 expect(forecastLines(linePack,data,true,now+900000).features[0].properties.state).toBe('STALE');
 expect(isMapReportCurrent(data,r,true,now-1)).toBe(false);
 r.bulletin.received_at=new Date(now+1000).toISOString();expect(isMapReportCurrent(data,r,true,now)).toBe(false);r.bulletin.received_at=new Date(now).toISOString();
 r.bulletin.official_valid_until=new Date(now+1000).toISOString();expect(isMapReportCurrent(data,r,true,now+1000)).toBe(false);
 data.sources[1].recovery!.scan_status='SCANNING';expect(isMapReportCurrent(data,r,true,now)).toBe(false);
});
it('does not let an independent cancellation clear an active unit and exposes overlap conflicts',()=>{
 const data=mapFixture(),first=data.reports[0];
 const other=structuredClone(first);other.bulletin.group_id='c'.repeat(24);other.bulletin.report_id=`${'c'.repeat(24)}--${'b'.repeat(24)}`;
 other.forecast_areas[0].status='CANCELLED';other.forecast_areas[0].warning_class='NONE';data.reports.push(other);
 expect(forecastLines(linePack,data,true,now).features[0].properties.state).toBe('ACTIVE');
 other.bulletin.lifecycle='CONFLICT';expect(forecastLines(linePack,data,true,now).features[0].properties.state).toBe('CONFLICT');
 other.bulletin.lifecycle='STALE';expect(forecastLines(linePack,data,true,now).features[0].properties.state).toBe('CONFLICT');
});
it('does not map old historical bulletins with a current registry or expired review',()=>{
 const data=mapFixture();data.reports[0].bulletin.issued_at='2011-03-11T05:46:00Z';
 expect(forecastLines(linePack,data,false,now).features).toHaveLength(0);
 expect(forecastLines(linePack,data,false,now).unmapped).toEqual(['100']);
 expect(forecastLines(linePack,mapFixture(),true,Date.parse(manifest.review_due_at)).features).toHaveLength(0);
});
it('loads actual pinned coastal lines with no guessed polygons or unassigned codes',async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(readFileSync(resolve(__dirname,'../public'+path)))));
 const pack=await loadForecastLinePack();expect(pack.geometry.features).toHaveLength(66);
 expect(Object.keys(pack.manifest.codes)).toHaveLength(98);
 expect(pack.geometry.features.every(f=>f.geometry.type==='MultiLineString'&&f.properties.code!=='0')).toBe(true);
 const bytes=readFileSync(resolve(__dirname,'../public'+pin.path));expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256);
},20000);
it('rejects corrupt hashes and oversized streamed responses',async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}')));
 await expect(loadForecastLinePack()).rejects.toThrow('integrity');
 await expect(boundedText(new Response('12345'),4)).rejects.toThrow('capacity');
});
