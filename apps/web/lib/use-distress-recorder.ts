'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

export const MAX_RECORDING_MS=30_000;
type Session={rec:MediaRecorder;stream:MediaStream;timer:ReturnType<typeof setTimeout>;cancelled:boolean;done:boolean};
const release=(stream:MediaStream)=>{for(const t of stream.getTracks())try{t.stop();}catch{/* already stopped */}};

/** Push-to-talk recorder: hard 30 s client limit; the microphone is always released on stop, failure or unmount.
 * Each session owns its timer and stream, so a stale timer can never stop (or leak) a different session. */
export function useDistressRecorder(onAudio:(blob:Blob)=>void){
 const [recording,setRecording]=useState(false),[starting,setStarting]=useState(false),[failed,setFailed]=useState(false);
 const session=useRef<Session|null>(null),handler=useRef(onAudio),mounted=useRef(true),startToken=useRef(0),startingRef=useRef(false);
 handler.current=onAudio;
 const stopSession=useCallback((s:Session)=>{
  clearTimeout(s.timer);
  try{if(s.rec.state!=='inactive')s.rec.stop();}catch{/* recorder already gone */}
  release(s.stream);
  // Reset even if the browser never fires onstop.
  if(session.current===s){session.current=null;if(mounted.current)setRecording(false);}
 },[]);
 const stop=useCallback(()=>{
  startToken.current++;startingRef.current=false;// also abandons a start still waiting for permission
  const s=session.current;
  if(s)stopSession(s);
  if(mounted.current){setRecording(false);setStarting(false);}
 },[stopSession]);
 const start=useCallback(async()=>{
  if(session.current||startingRef.current)return;
  const token=++startToken.current;
  startingRef.current=true;setFailed(false);setStarting(true);
  let stream:MediaStream|null=null;
  try{
   const Rec=(globalThis as {MediaRecorder?:typeof MediaRecorder}).MediaRecorder;
   if(!Rec||!navigator.mediaDevices?.getUserMedia)throw Error('unsupported');
   stream=await navigator.mediaDevices.getUserMedia({audio:true});
   // Unmounted, stopped or superseded while the permission prompt was open: never record.
   if(!mounted.current||token!==startToken.current||session.current){release(stream);return;}
   const mime=['audio/webm','audio/mp4'].find(m=>typeof Rec.isTypeSupported==='function'&&Rec.isTypeSupported(m));
   const rec=new Rec(stream,mime?{mimeType:mime}:undefined),chunks:Blob[]=[];
   const s:Session={rec,stream,timer:setTimeout(()=>stopSession(s),MAX_RECORDING_MS),cancelled:false,done:false};
   rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
   rec.onstop=()=>{
    if(s.done)return;s.done=true;
    clearTimeout(s.timer);release(s.stream);
    if(session.current===s)session.current=null;
    if(s.cancelled||!mounted.current)return;
    setRecording(false);
    const blob=new Blob(chunks,{type:rec.mimeType||mime||'audio/webm'});
    if(blob.size)handler.current(blob);
   };
   session.current=s;rec.start();setRecording(true);
  }catch{
   if(stream)release(stream);
   if(mounted.current&&token===startToken.current){setRecording(false);setFailed(true);}
  }finally{
   if(token===startToken.current){startingRef.current=false;if(mounted.current)setStarting(false);}
  }
 },[stopSession]);
 useEffect(()=>{
  mounted.current=true;
  return()=>{mounted.current=false;startToken.current++;startingRef.current=false;const s=session.current;if(s){s.cancelled=true;stopSession(s);}};
 },[stopSession]);
 return {recording,starting,failed,start,stop};
}
