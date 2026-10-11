import {afterEach,describe,expect,it,vi} from 'vitest';
import {validJapanVectorTile,validReferenceGlyph} from '../lib/japan-reference-map';
import {GET as vectorGET} from '../app/api/reference-vectors/[z]/[x]/[y]/route';
import {GET as glyphGET} from '../app/api/reference-glyphs/[font]/[range]/route';
import {REFERENCE_VECTOR_LAYERS,REFERENCE_VECTOR_SOURCE,REFERENCE_REGION_LAYER} from '../lib/reference-map-style';

afterEach(()=>vi.unstubAllGlobals());
const vectorRequest=()=>vectorGET(new Request('http://local/api/reference-vectors/9/454/201'),{params:Promise.resolve({z:'9',x:'454',y:'201'})});
describe('bounded GSI geography detail',()=>{
 it('accepts only Japan tiles in the official vector zoom range and fixed font ranges',()=>{
  expect(validJapanVectorTile('9','454','201')?.upstream).toBe('https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/9/454/201.pbf');
  for(const [z,x,y] of [['3','7','3'],['17','116401','51602'],['9','0','0'],['9','0454','201'],['9','454','../1']])expect(validJapanVectorTile(z,x,y)).toBeNull();
  expect(validReferenceGlyph('NotoSansCJKjp-Regular','0-255')).toContain('/noto-jp/NotoSansCJKjp-Regular/0-255.pbf');
  for(const [font,range] of [['other','0-255'],['../other','0-255'],['NotoSansCJKjp-Regular','1-256'],['NotoSansCJKjp-Regular','65536-65791'],['NotoSansCJKjp-Regular','0-9999']])expect(validReferenceGlyph(font,range)).toBeNull();
 });
 it('returns binary tiles and disables redirects without forwarding user headers',async()=>{
  const fetcher=vi.fn(async()=>new Response(new Uint8Array([0x1a,0]),{headers:{'Content-Type':'application/octet-stream'}}));vi.stubGlobal('fetch',fetcher);
  const result=await vectorRequest();expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toContain('public');
  expect(fetcher.mock.calls[0]).toEqual(['https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/9/454/201.pbf',expect.objectContaining({redirect:'error',headers:{Accept:'application/x-protobuf'}})]);
 });
 it('rejects invalid coordinates before upstream fetch and rejects HTML masquerading as PBF',async()=>{
  const fetcher=vi.fn(async()=>new Response('<html>',{headers:{'Content-Type':'application/octet-stream'}}));vi.stubGlobal('fetch',fetcher);
  expect((await vectorGET(new Request('http://local/'),{params:Promise.resolve({z:'9',x:'0',y:'0'})})).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();expect((await vectorRequest()).status).toBe(502);
 });
 it('bounds a chunked payload even when Content-Length is absent',async()=>{
  const cancel=vi.fn();const chunk=new Uint8Array(800000);chunk[0]=0x1a;
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(chunk);c.enqueue(chunk);},cancel}),{headers:{'Content-Type':'application/x-protobuf'}})));
  expect((await vectorRequest()).status).toBe(502);expect(cancel).toHaveBeenCalled();
 });
 it('fails without cache on unavailable upstream and validates glyph payloads',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('offline');}));
  const failure=await vectorRequest();expect(failure.status).toBe(503);expect(failure.headers.get('Cache-Control')).toBe('no-store');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([0x0a,0]),{headers:{'Content-Type':'application/octet-stream'}})));
  expect((await glyphGET(new Request('http://local/'),{params:Promise.resolve({font:'NotoSansCJKjp-Regular',range:'0-255'})})).status).toBe(200);
 });
 it('uses collision-aware geographic labels with progressively revealed roads and places',()=>{
  expect(REFERENCE_VECTOR_SOURCE.minzoom).toBe(4);expect(REFERENCE_REGION_LAYER.maxzoom).toBe(6);
  const symbols=REFERENCE_VECTOR_LAYERS.filter(l=>l.type==='symbol');
  expect(symbols.map(l=>l.minzoom)).toEqual([6,6,11,13]);
  for(const layer of symbols)expect(layer.layout?.['text-allow-overlap']).toBe(false);
  expect(REFERENCE_VECTOR_LAYERS.find(l=>l.id==='reference-local-roads')?.minzoom).toBe(12);
  expect(REFERENCE_VECTOR_LAYERS.some(l=>/safe|evacuation|shelter/.test(l.id))).toBe(false);
 });
});
