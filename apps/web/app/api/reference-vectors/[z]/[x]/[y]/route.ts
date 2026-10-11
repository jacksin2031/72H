import {validJapanVectorTile} from '@/lib/japan-reference-map';
import {gsiPbfResponse} from '@/lib/gsi-pbf-response';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{z:string;x:string;y:string}>}){
 const {z,x,y}=await params,tile=validJapanVectorTile(z,x,y);
 return tile?gsiPbfResponse(tile.upstream,'vector'):new Response('Outside Japan reference area',{status:404,headers:{'Cache-Control':'no-store'}});
}
