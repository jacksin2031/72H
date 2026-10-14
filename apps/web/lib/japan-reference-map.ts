/**
 * Public geographical reference only. Rectangular coverage permits navigation
 * around Japanese territories but is NOT an official national boundary,
 * hazard polygon, coast distance, shelter eligibility or evacuation footprint.
 */
export const JAPAN_VIEW_BOUNDS = [
  [120,19],[156,48],
] as const;
export const JAPAN_DEFAULT_CENTER = [137.2,36.3] as const;
export const JAPAN_TILE_ZOOM = {min:3,max:17} as const;
export const GSI_STD_TILE_ROOT = 'https://cyberjapandata.gsi.go.jp/xyz/std' as const;
export const GSI_VECTOR_TILE_ROOT='https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap' as const;

export function longitudeAtTile(z:number,x:number):number {return x/(2**z)*360-180;}
export function latitudeAtTile(z:number,y:number):number{
 return Math.atan(Math.sinh(Math.PI*(1-2*y/(2**z))))*180/Math.PI;
}
export function validJapanTile(rawZ:string,rawX:string,rawY:string):
  {z:number;x:number;y:number;upstream:string}|null {
 const re=/^(0|[1-9][0-9]{0,7})$/;
 if(!re.test(rawZ)||!re.test(rawX)||!re.test(rawY))return null;
 const [z,x,y]=[Number(rawZ),Number(rawX),Number(rawY)];
 if(!Number.isSafeInteger(z)||!Number.isSafeInteger(x)||!Number.isSafeInteger(y)
  ||z<JAPAN_TILE_ZOOM.min||z>JAPAN_TILE_ZOOM.max)return null;
 const dim=2**z;
 if(x>=dim||y>=dim)return null;
 const west=longitudeAtTile(z,x),east=longitudeAtTile(z,x+1);
 const north=latitudeAtTile(z,y),south=latitudeAtTile(z,y+1);
 if(east<JAPAN_VIEW_BOUNDS[0][0]||west>JAPAN_VIEW_BOUNDS[1][0]
  ||north<JAPAN_VIEW_BOUNDS[0][1]||south>JAPAN_VIEW_BOUNDS[1][1])return null;
 return {z,x,y,upstream:`${GSI_STD_TILE_ROOT}/${z}/${x}/${y}.png`};
}
export function validJapanVectorTile(z:string,x:string,y:string){
 const tile=validJapanTile(z,x,y);
 return tile&&tile.z>=4&&tile.z<=16
   ?{...tile,upstream:`${GSI_VECTOR_TILE_ROOT}/${tile.z}/${tile.x}/${tile.y}.pbf`}:null;
}
export function validReferenceGlyph(font:string,range:string):string|null{
 if(font!=='NotoSansCJKjp-Regular'||! /^(0|[1-9][0-9]{0,4})-(0|[1-9][0-9]{0,4})$/.test(range))return null;
 const [start,end]=range.split('-').map(Number);
 if(start%256!==0||end!==start+255||end>65535)return null;
 return `https://maps.gsi.go.jp/xyz/noto-jp/${font}/${range}.pbf`;
}
export const GSI_ATTRIBUTION_URL = 'https://maps.gsi.go.jp/development/ichiran.html' as const;
export const NATURAL_EARTH_LICENSE_URL = 'https://www.naturalearthdata.com/about/terms-of-use/' as const;
