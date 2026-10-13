import {expect,it,vi} from 'vitest';
import {GeoJSONWrapper,fromVectorTileJs} from '@maplibre/vt-pbf';
import {VectorTile,VectorTileFeature} from '@mapbox/vector-tile';
import {PbfReader,PbfWriter} from 'pbf';
import {withGsiLandCoverage} from '../lib/gsi-land-coverage';
const decode=(bytes:Uint8Array)=>new VectorTile(new PbfReader(bytes));
const polygon=(ring:[number,number][])=>({type:3 as const,geometry:[ring],tags:{ftCode:5000}});
function tile(layers:Record<string,{features:ReturnType<typeof polygon>[]}>,extent=4096){
  return fromVectorTileJs({layers:Object.fromEntries(Object.entries(layers).map(([name,data])=>{
    const layer=new GeoJSONWrapper(data.features,{extent,version:2});layer.name=name;return [name,layer];
  }))});
}
it('adds a tile-sized land base below the unchanged official water/shore geometry',()=>{
  const water:[number,number][]=[[0,0],[2048,0],[2048,4096],[0,4096],[0,0]];
  const original=tile({waterarea:{features:[polygon(water)]}});
  const result=withGsiLandCoverage(original),parsed=decode(result);
  expect(result.slice(0,original.length)).toEqual(original);
  expect(parsed.layers['72h-land-coverage'].feature(0).bbox()).toEqual([0,0,4096,4096]);
  expect(parsed.layers.waterarea.feature(0).loadGeometry()).toEqual(decode(original).layers.waterarea.feature(0).loadGeometry());
  const edges=parsed.layers['72h-water-edges'].feature(0).loadGeometry();
  expect(edges.map(line=>line.map(p=>[p.x,p.y]))).toEqual([[[2048,0],[2048,4096]]]);
});
it('respects official extent and does not paint unknown/empty or malformed tiles as land',()=>{
  const original=tile({waterarea:{features:[polygon([[0,0],[8192,0],[8192,8192],[0,8192],[0,0]])]}},8192);
  expect(decode(withGsiLandCoverage(original)).layers['72h-land-coverage'].extent).toBe(8192);
  for(const empty of [new Uint8Array([0x1a,0]),tile({waterarea:{features:[]}})])expect(withGsiLandCoverage(empty)).toEqual(empty);
  expect(()=>withGsiLandCoverage(new Uint8Array([0x1a,0xff]))).toThrow();
  expect(()=>withGsiLandCoverage(new Uint8Array(1_500_001))).toThrow();
});
it('rejects a tiny oversized ClosePath before geometry allocation',()=>{
  const g=new PbfWriter();for(const n of [9,0,0,18,20,0,0,20,200001*8+7,9,2,0])g.writeVarint(n);
  const f=new PbfWriter();f.writeVarintField(3,3);f.writeBytesField(4,g.finish());
  const l=new PbfWriter();l.writeStringField(1,'waterarea');l.writeBytesField(2,f.finish());l.writeVarintField(5,4096);l.writeVarintField(15,2);
  const root=new PbfWriter();root.writeBytesField(3,l.finish());
  const allocate=vi.spyOn(VectorTileFeature.prototype,'loadGeometry');
  try{expect(()=>withGsiLandCoverage(root.finish())).toThrow('Invalid geography command');expect(allocate).not.toHaveBeenCalled();}
  finally{allocate.mockRestore();}
});
