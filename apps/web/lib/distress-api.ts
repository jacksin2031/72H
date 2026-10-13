import {z} from 'zod';
import {distressTagSchema,type DistressTag,type Language} from './contracts';
import {boundedText} from './disaster-map';

export type DistressScope='live'|'replay'|'mock-live';
export type DistressInputMode='BUTTON'|'VOICE'|'TEXT';
const extractSchema=z.object({tags:z.array(distressTagSchema).max(7),route_blocked_hint:z.string().max(80).nullable(),
 mode:z.enum(['GEMINI','UNAVAILABLE']),reason_code:z.string().max(64).nullable()}).strict();
const placeId=z.string().regex(/^[a-z_]+:[A-Za-z0-9]{1,40}$/);
export const appliedAdviceSchema=z.object({candidate_order:z.array(placeId).max(12),excluded:z.array(placeId).max(12),suggest_sos:z.boolean(),
 emphasis_clause_ids:z.array(z.enum(['MOVE_UP_NOW','AVOID_WATER','STAY_TOGETHER','CALL_FOR_HELP','KEEP_PHONE_POWER'])).max(5),
 raised_level:z.boolean(),rejected_fields:z.array(z.string().max(64)).max(16),mode:z.enum(['GEMINI','DETERMINISTIC_FALLBACK']),
 reason_code:z.string().max(64).nullable()}).strict();
export type AppliedAdvice=z.infer<typeof appliedAdviceSchema>;
export type AdviceBody={language:Language;candidates:{place_id:string;name:string;walk_minutes:number}[];route_blocked_hint:string|null};
const MAX_AUDIO=1_000_000,MAX_SNAPSHOT=4_000_000;

async function toBase64(blob:Blob){
 // Older Safari has no Blob.arrayBuffer; FileReader is the portable fallback.
 const buffer=typeof blob.arrayBuffer==='function'?await blob.arrayBuffer():await new Promise<ArrayBuffer>((resolve,reject)=>{
  const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=()=>reject(r.error);r.readAsArrayBuffer(blob);});
 const bytes=new Uint8Array(buffer);let s='';
 for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return btoa(s);
}
const headers=(scope:DistressScope,accessKey?:string):Record<string,string>=>({'Content-Type':'application/json',...(scope==='mock-live'&&accessKey?{'X-Drill-Key':accessKey}:{})});
const path=(scope:DistressScope,sessionId:string,suffix:string)=>`/api/${scope}/${encodeURIComponent(sessionId)}/${suffix}`;

/** AI tag extraction. Any failure, refusal or invalid payload yields null; the person then uses the buttons. */
export async function extractDistress(i:{sessionId:string;language:Language;text?:string;audio?:Blob;scope?:DistressScope;accessKey?:string}):Promise<{tags:DistressTag[];hint:string|null}|null>{
 try{
  let body:Record<string,string>={session_id:i.sessionId,language:i.language};
  if(i.audio){
   if(i.audio.size>MAX_AUDIO||i.audio.size===0)return null;
   const mime=i.audio.type.startsWith('audio/mp4')?'audio/mp4':'audio/webm';
   body={...body,audio_base64:await toBase64(i.audio),audio_mime:mime};
  }else if(i.text&&i.text.trim()&&i.text.trim().length<=500)body={...body,text:i.text.trim()};
  else return null;
  // The server only extracts for an existing session; mock-live sessions also need the drill key.
  const r=await fetch('/api/distress/extract',{method:'POST',cache:'no-store',headers:headers(i.scope??'live',i.accessKey),body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok)return null;
  const p=extractSchema.safeParse(JSON.parse((await boundedText(r,16_000)).text));
  return p.success&&p.data.mode==='GEMINI'?{tags:[...new Set(p.data.tags)],hint:p.data.route_blocked_hint}:null;
 }catch{return null;}
}

/** Returns the raw snapshot JSON (the caller parses it with its scope's schema), or null on failure. */
export async function reportDistress(scope:DistressScope,sessionId:string,tags:readonly DistressTag[],mode:DistressInputMode,accessKey?:string):Promise<unknown>{
 try{
  const r=await fetch(path(scope,sessionId,'distress'),{method:'POST',cache:'no-store',headers:headers(scope,accessKey),
   body:JSON.stringify({tags:[...new Set(tags)],input_mode:mode}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)return null;
  return JSON.parse((await boundedText(r,MAX_SNAPSHOT)).text) as unknown;
 }catch{return null;}
}

/** Advice is validated strictly; the snapshot is returned raw for the caller's schema. */
export async function requestAdvice(scope:DistressScope,sessionId:string,body:AdviceBody,accessKey?:string):Promise<{advice:AppliedAdvice;snapshot:unknown}|null>{
 try{
  const r=await fetch(path(scope,sessionId,'distress/advice'),{method:'POST',cache:'no-store',headers:headers(scope,accessKey),
   body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok)return null;
  const raw=JSON.parse((await boundedText(r,MAX_SNAPSHOT)).text) as {advice?:unknown;snapshot?:unknown};
  const advice=appliedAdviceSchema.safeParse(raw?.advice);
  return advice.success&&raw.snapshot!==undefined?{advice:advice.data,snapshot:raw.snapshot}:null;
 }catch{return null;}
}
