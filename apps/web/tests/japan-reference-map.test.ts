import {describe,expect,it,afterEach,vi} from 'vitest';
import {
 validJapanTile,longitudeAtTile,latitudeAtTile,JAPAN_VIEW_BOUNDS,
} from '../lib/japan-reference-map';
import {GET} from '../app/api/reference-tiles/[z]/[x]/[y]/route';

function tileAt(lng:number,lat:number,z:number){
 const n=2**z;
 return {
  z:String(z),
  x:String(Math.floor((lng+180)/360*n)),
  y:String(Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)),
 };
}
const path=(z:string,x:string,y:string)=>({params:Promise.resolve({z,x,y})});
describe('All Japan GSI tile allowlisting',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('includes Japan-wide coordinates including Okinawa, Hokkaido, Sanriku sea and eastern island',()=>{
  for(const p of [
   [139.75,35.69], // Tokyo
   [142.86,38.10333], // archived offshore 311 epicenter
   [127.68,26.21], // Okinawa
   [145.13,43.05], // eastern Hokkaido
   [153.98,24.29], // Minamitorishima
   [122.99,24.44], // Yonaguni
  ]){
   const selected=tileAt(p[0],p[1],10);
   expect(validJapanTile(selected.z,selected.x,selected.y)).not.toBeNull();
  }
 });
 it('rejects tiles far beyond Japan and malicious URL parameters',()=>{
  for(const p of [[-74,40.7],[10,52],[170,60],[100,2]]) {
   const selected=tileAt(p[0],p[1],11);
   expect(validJapanTile(selected.z,selected.x,selected.y)).toBeNull();
  }
  for(const p of [
   ['2','3','3'],['18','500','500'],['9','99999','3'],['9','3','99999'],
   ['6','-1','20'],['6','01','20'],['6','3','9.png'],['6','http://fake','21'],
  ])expect(validJapanTile(p[0],p[1],p[2])).toBeNull();
  expect(JAPAN_VIEW_BOUNDS).toEqual([[120,19],[156,48]]);
  expect(longitudeAtTile(3,4)).toBe(0);
  expect(latitudeAtTile(3,4)).toBeCloseTo(0,5);
 });
 it('uses fixed GSI upstream only, no arbitrary user host',async()=>{
  const sent:string[]=[];
  const png=new Uint8Array([137,80,78,71,13,10,26,10,0]);
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
   sent.push(input);
   return new Response(png,{status:200,headers:{'content-type':'image/png'}});
  }));
  const selection=tileAt(139.75,35.69,6);
  const response=await GET(new Request('http://localhost/untrusted'),path(selection.z,selection.x,selection.y));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('cache-control')).toContain('max-age=86400');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatch(/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/std\/[0-9]+\/[0-9]+\/[0-9]+\.png$/);
  const invalid=await GET(new Request('http://localhost'),path('9','99999','99999'));
  expect(invalid.status).toBe(404);
  expect(sent).toHaveLength(1);
 });
 it('does not emit HTML, unsafe payloads or unauthorized redirects from upstream',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('<script>alert(1)</script>',{status:200,headers:{'content-type':'text/html'}})));
  const selection=tileAt(137.2,35.69,7);
  expect((await GET(new Request('http://localhost'),path(selection.z,selection.x,selection.y))).status).toBe(502);
 });
});
