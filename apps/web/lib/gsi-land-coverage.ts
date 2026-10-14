import {VectorTile} from '@mapbox/vector-tile';
import {GeoJSONWrapper,fromVectorTileJs} from '@maplibre/vt-pbf';
import {PbfReader} from 'pbf';

const MAX_BYTES=1_500_000,MAX_POINTS=200_000;
/** Validate packed commands before VectorTile allocates Point objects. A tiny
 * corrupt ClosePath command can otherwise expand into millions of clones. */
function preflightWater(bytes:Uint8Array){
  let layers=0,points=0;
  const reader=new PbfReader(bytes);
  reader.readFields((tag,_result,pbf)=>{
    if(tag!==3)return;
    if(++layers>64)throw Error('Geography layer limit');
    const layer=pbf.readMessage((field,value,lp)=>{
      if(field===1){
        if(value.name!==null)throw Error('Duplicate geography name');
        value.name=lp.readString();if(value.name.length>128)throw Error('Geography name limit');
        if(value.name!=='waterarea')value.features=[];
      }else if(field===2&&(value.name===null||value.name==='waterarea')){
        if(value.features.length>=10000)throw Error('Geography feature limit');
        value.features.push(lp.readBytes());
      }else if(field===5){value.extent=lp.readVarint();}
    },{name:null as string|null,features:[] as Uint8Array[],extent:4096});
    if(layer.name!=='waterarea')return;
    if(!Number.isInteger(layer.extent)||layer.extent<256||layer.extent>16384)throw Error('Invalid geography extent');
    for(const feature of layer.features){
      const fp=new PbfReader(feature);
      fp.readFields((field,_value,f)=>{
        if(field!==4)return;
        const gp=new PbfReader(f.readBytes());let gx=0,gy=0;
        while(gp.pos<gp.length){
          const packed=gp.readVarint(),command=packed%8,count=Math.floor(packed/8);
          if(!Number.isSafeInteger(count)||count<1||count>MAX_POINTS
            ||!([1,2,7].includes(command))||(command===7&&count!==1))throw Error('Invalid geography command');
          points+=count;if(points>MAX_POINTS)throw Error('Geography point limit');
          if(command!==7)for(let i=0;i<count;i++){
            const x=gp.readSVarint(),y=gp.readSVarint();
            gx+=x;gy+=y;
            if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||!Number.isSafeInteger(gx)||!Number.isSafeInteger(gy)
              ||Math.abs(gx)>layer.extent*8||Math.abs(gy)>layer.extent*8)throw Error('Invalid geography coordinate');
          }
        }
        if(gp.pos!==gp.length)throw Error('Truncated geography command');
      },null);
      if(fp.pos!==fp.length)throw Error('Truncated geography feature');
    }
  },null);
  if(reader.pos!==reader.length)throw Error('Truncated geography tile');
}
/** GSI z4–7 waterarea contains inland water only (55000), not the ocean mask.
 * The tile-sized land background requires z8+ detailed water geometry (5000).
 * Overview/unknown schema tiles retain the Natural Earth land/ocean below.
 * Original layers remain byte-for-byte intact. These are geography, not hazards.
 */
export function withGsiLandCoverage(bytes:Uint8Array,zoom:number):Uint8Array{
  if(!bytes.length||bytes.length>MAX_BYTES)throw Error('Invalid geography capacity');
  if(!Number.isInteger(zoom)||zoom<4||zoom>16)throw Error('Invalid geography zoom');
  preflightWater(bytes);
  if(zoom<8)return bytes;
  const tile=new VectorTile(new PbfReader(bytes)),water=tile.layers.waterarea;
  if(!water?.length)return bytes;
  const extent=water.extent;
  if(!Number.isInteger(extent)||extent<256||extent>16384||water.length>10000
    ||tile.layers['72h-land-coverage']||tile.layers['72h-water-edges'])throw Error('Invalid geography schema');
  const lines:[number,number][][]= [];let points=0,polygons=0;
  for(let i=0;i<water.length;i++){
    const feature=water.feature(i);if(feature.type!==3)continue;
    if(feature.properties.ftCode!==5000)return bytes;
    for(const ring of feature.loadGeometry()){
      if(ring.length<4)continue;
      polygons++;points+=ring.length;if(points>MAX_POINTS)throw Error('Geography point limit');
      let run:[number,number][]=[];
      const flush=()=>{if(run.length>1)lines.push(run);run=[];};
      for(let j=1;j<ring.length;j++){
        const a=ring[j-1],b=ring[j];
        // Buffered/clipped tile edges are not coastlines. Keep real segments
        // crossing a tile boundary unchanged; the renderer clips them itself.
        if((a.x<=0&&b.x<=0)||(a.x>=extent&&b.x>=extent)||(a.y<=0&&b.y<=0)||(a.y>=extent&&b.y>=extent)){flush();continue;}
        if(!run.length)run.push([a.x,a.y]);run.push([b.x,b.y]);
      }
      flush();
    }
  }
  if(!polygons)return bytes;
  const ground=new GeoJSONWrapper([{type:3,geometry:[[[0,0],[extent,0],[extent,extent],[0,extent],[0,0]]],tags:{kind:'GSI_TILE_LAND_BASE'}}],{extent,version:2});
  const edges=new GeoJSONWrapper(lines.length?[{type:2,geometry:lines,tags:{kind:'GSI_WATER_BOUNDARY'}}]:[],{extent,version:2});
  ground.name='72h-land-coverage';edges.name='72h-water-edges';
  const extra=fromVectorTileJs({layers:{'72h-land-coverage':ground,'72h-water-edges':edges}});
  if(bytes.length+extra.length>MAX_BYTES)throw Error('Aligned geography capacity');
  const result=new Uint8Array(bytes.length+extra.length);result.set(bytes);result.set(extra,bytes.length);return result;
}
