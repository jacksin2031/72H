import {validJapanTile} from '@/lib/japan-reference-map';
export const runtime='nodejs';
export const dynamic='force-dynamic';

/** Allowlisted server-side GSI standard tiles for the Japan viewing extent.
 * No arbitrary URLs, credentials, cookies or GPS are accepted or forwarded.
 * Keeping tiles on our origin avoids CORS failures and cross-origin leaking
 * of a handset's map browsing history. Cloud CDN/edge caching is encouraged.
 */
export async function GET(_request:Request,{
 params,
}:{params:Promise<{z:string;x:string;y:string}>}):Promise<Response>{
 const {z,x,y}=await params;
 const tile=validJapanTile(z,x,y);
 if(!tile)return new Response('Tile outside Japan reference area',{status:404,headers:{'Cache-Control':'no-store'}});
 try {
  const upstream=await fetch(tile.upstream,{
   method:'GET',signal:AbortSignal.timeout(9000),
   headers:{'Accept':'image/png'},next:{revalidate:86400},
  });
  if(!upstream.ok)return new Response('Reference tile unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
  const contentType=upstream.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const declared=Number(upstream.headers.get('content-length')||'0');
  if(contentType!=='image/png'||declared>1_500_000)
   return new Response('Unexpected upstream tile',{status:502,headers:{'Cache-Control':'no-store'}});
  const bytes=await upstream.arrayBuffer();
  if(!bytes.byteLength||bytes.byteLength>1_500_000||
     ![0x89,0x50,0x4e,0x47].every((byte,i)=>new Uint8Array(bytes)[i]===byte))
   return new Response('Invalid upstream tile',{status:502,headers:{'Cache-Control':'no-store'}});
  return new Response(bytes,{
   status:200,headers:{
    'Content-Type':'image/png','X-Content-Type-Options':'nosniff',
    'Cache-Control':'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
    'X-Map-Source':'GSI Japan standard map (reference only)',
   },
  });
 }catch{return new Response('Reference tiles temporarily unavailable',{
   status:503,headers:{'Cache-Control':'no-store'},
 });}
}
