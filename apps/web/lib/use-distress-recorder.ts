'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

export const MAX_RECORDING_MS=30_000;
type Session={rec:MediaRecorder;stream:MediaStream;timer:ReturnType<typeof setTimeout>;cancelled:boolean};
const release=(stream:MediaStream)=>{for(const t of stream.getTracks())try{t.stop();}catch{/* already stopped */}};

/** Push-to-talk recorder: hard 30 s client limit; the microphone is always released on stop, failure or unmount. */
export function useDistressRecorder(onAudio:(blob:Blob)=>void){
 const [recording,setRecording]=useState(false),[failed,setFailed]=useState(false);
 const session=useRef<Session|null>(null),handler=useRef(onAudio);handler.current=onAudio;
 const stop=useCallback(()=>{
  const s=session.current;if(!s)return;
  clearTimeout(s.timer);
  try{if(s.rec.state!=='inactive')s.rec.stop();}catch{/* recorder already gone */}
  release(s.stream);
 },[]);
 const start=useCallback(async()=>{
  if(session.current)return;
  setFailed(false);
  let stream:MediaStream|null=null;
  try{
   const Rec=(globalThis as {MediaRecorder?:typeof MediaRecorder}).MediaRecorder;
   if(!Rec||!navigator.mediaDevices?.getUserMedia)throw Error('unsupported');
   stream=await navigator.mediaDevices.getUserMedia({audio:true});
   const mime=['audio/webm','audio/mp4'].find(m=>typeof Rec.isTypeSupported==='function'&&Rec.isTypeSupported(m));
   const rec=new Rec(stream,mime?{mimeType:mime}:undefined),chunks:Blob[]=[],own=stream;
   const s:Session={rec,stream:own,timer:setTimeout(stop,MAX_RECORDING_MS),cancelled:false};
   rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
   rec.onstop=()=>{
    clearTimeout(s.timer);release(own);
    if(session.current===s)session.current=null;
    if(s.cancelled)return;
    setRecording(false);
    const blob=new Blob(chunks,{type:rec.mimeType||mime||'audio/webm'});
    if(blob.size)handler.current(blob);
   };
   session.current=s;rec.start();setRecording(true);
  }catch{
   if(stream)release(stream);
   session.current=null;setRecording(false);setFailed(true);
  }
 },[stop]);
 useEffect(()=>()=>{const s=session.current;if(s){s.cancelled=true;stop();session.current=null;}},[stop]);
 return {recording,failed,start,stop};
}
