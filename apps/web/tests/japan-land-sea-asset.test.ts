import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {resolve} from 'node:path';

const file=resolve(__dirname,'../public/maps/japan-land-50m.geojson');
const bytes=readFileSync(file);
const land=JSON.parse(bytes.toString('utf8')) as {
 type:'FeatureCollection';features:Array<{geometry:{type:string;coordinates:number[][][]}}>;
};
function inRing(lng:number,lat:number,ring:number[][]):boolean{
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];
  if((a[1]>lat)!==(b[1]>lat) &&lng<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
const isLand=(lng:number,lat:number)=>land.features.some(f=>{
 const [outer,...holes]=f.geometry.coordinates;
 return inRing(lng,lat,outer) && !holes.some(h=>inRing(lng,lat,h));
});
describe('offline nationwide sea/land geographic boundary',()=>{
 it('is pinned with SHA-256 and cannot silently change coast geometry',()=>{
  expect(bytes.length).toBe(284073);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('32a1f99f53084df8d5aaae431d5edfbb41925248954a3836b071ec0861b29b42');
  expect(land.type).toBe('FeatureCollection');
  expect(land.features).toHaveLength(71);
 });
 it('treats locations on Honshu and Hokkaido as land but the 311 offshore epicenter as sea',()=>{
  expect(isLand(139.76,35.68)).toBe(true);
  expect(isLand(141.35,43.06)).toBe(true);
  expect(isLand(142.86,38.103333)).toBe(false);
 });
});
