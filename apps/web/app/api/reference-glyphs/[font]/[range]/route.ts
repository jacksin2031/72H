import {validReferenceGlyph} from '@/lib/japan-reference-map';
import {gsiPbfResponse} from '@/lib/gsi-pbf-response';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{font:string;range:string}>}){
 const {font,range}=await params,upstream=validReferenceGlyph(font,range);
 return upstream?gsiPbfResponse(upstream,'glyph'):new Response('Unknown reference font',{status:404,headers:{'Cache-Control':'no-store'}});
}
