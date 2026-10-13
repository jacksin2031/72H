import {validJapanVectorTile} from '@/lib/japan-reference-map';
import {gsiPbfResponse} from '@/lib/gsi-pbf-response';
import {withGsiLandCoverage} from '@/lib/gsi-land-coverage';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{z:string;x:string;y:string}>}){
 const {z,x,y}=await params,tile=validJapanVectorTile(z,x,y);
 if(!tile)return new Response('Outside Japan reference area',{status:404,headers:{'Cache-Control':'no-store'}});
 const response=await gsiPbfResponse(tile.upstream,'vector');if(!response.ok)return response;
 try{
  const bytes=withGsiLandCoverage(new Uint8Array(await response.arrayBuffer()));
  return new Response(new Uint8Array(bytes),{headers:response.headers});
 }catch{return new Response('Reference geography invalid',{status:502,headers:{'Cache-Control':'no-store'}});}
}
