/** Caller supplies an already allowlisted GSI URL. No incoming headers or
 * arbitrary URLs are forwarded. Bound the stream as well as Content-Length.
 */
export async function gsiPbfResponse(upstream:string,kind:'vector'|'glyph'):Promise<Response>{
 const failure=(status:number)=>new Response('Reference detail unavailable',{status,headers:{'Cache-Control':'no-store'}});
 try{
  const response=await fetch(upstream,{redirect:'error',signal:AbortSignal.timeout(9000),
    headers:{Accept:'application/x-protobuf'},next:{revalidate:86400}});
  if(!response.ok)return failure(503);
  const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const max=1_500_000;
  if(!['application/octet-stream','application/x-protobuf','application/protobuf','application/vnd.mapbox-vector-tile'].includes(type??'')
    ||Number(response.headers.get('content-length')||0)>max||!response.body)return failure(502);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;
      length+=value.byteLength;if(length>max){await reader.cancel();return failure(502);}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  // MVT top-level field 3 = layers; glyph field 1 = font stacks.
  if(!length||bytes[0]!== (kind==='vector'?0x1a:0x0a))return failure(502);
  return new Response(bytes,{headers:{'Content-Type':'application/x-protobuf',
    'X-Content-Type-Options':'nosniff','X-Map-Source':'GSI geography reference only',
    'Cache-Control':'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800'}});
 }catch{return failure(503);}
}
