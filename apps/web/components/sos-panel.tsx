'use client';
import {useEffect,useRef,useState} from 'react';
import type {DistressTag,Language} from '../lib/contracts';
import {NET119_URL,buildSosMessage,smsHref,sosText} from '../lib/distress';
import type {SosProfile} from '../lib/emergency-contacts';

type Alarm={ctx:AudioContext;osc:OscillatorNode;timer:ReturnType<typeof setInterval>};
type SosLocation={lat:number;lng:number;accuracy_m:number|null}|null;

/** User-triggered only. Nothing here dials, sends or shares until the person taps. */
export function SosPanel({language,profile,tags,location,pinned}:{language:Language;profile:SosProfile;tags:readonly DistressTag[];location:SosLocation;pinned:boolean}){
 const t=sosText[language];
 const [active,setActive]=useState(false),[flashing,setFlashing]=useState(false),[flashOn,setFlashOn]=useState(true);
 const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine!==false);
 const alarm=useRef<Alarm|null>(null),stream=useRef<MediaStream|null>(null),run=useRef(0);
 useEffect(()=>{
  const on=()=>setOnline(true),off=()=>setOnline(false);
  window.addEventListener('online',on);window.addEventListener('offline',off);
  return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off);};
 },[]);
 const stopAll=()=>{
  run.current+=1;
  const a=alarm.current;alarm.current=null;
  if(a){clearInterval(a.timer);try{a.osc.stop();}catch{/* already stopped */}try{void a.ctx.close();}catch{/* already closed */}}
  const s=stream.current;stream.current=null;
  if(s)for(const track of s.getTracks())try{track.stop();}catch{/* already stopped */}
  setFlashing(false);setActive(false);
 };
 useEffect(()=>()=>{
  // Unmount: same teardown without touching state.
  run.current+=1;
  const a=alarm.current;alarm.current=null;
  if(a){clearInterval(a.timer);try{a.osc.stop();}catch{/* */}try{void a.ctx.close();}catch{/* */}}
  const s=stream.current;stream.current=null;
  if(s)for(const track of s.getTracks())try{track.stop();}catch{/* */}
 },[]);
 // Reduced motion only slows the flash; it is a rescue signal and is never disabled.
 useEffect(()=>{
  if(!flashing)return;
  const slow=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const id=setInterval(()=>setFlashOn(v=>!v),slow?1000:250);
  return()=>clearInterval(id);
 },[flashing]);
 const start=async()=>{
  if(alarm.current||active)return;
  const token=++run.current;setActive(true);
  const Ctor=(globalThis as unknown as {AudioContext?:typeof AudioContext}).AudioContext;
  if(Ctor){
   let ctx:AudioContext|null=null;
   try{
    ctx=new Ctor();const osc=ctx.createOscillator();osc.type='square';osc.frequency.value=3000;
    const gain=ctx.createGain();gain.gain.value=1;osc.connect(gain).connect(ctx.destination);osc.start();
    let on=true;const timer=setInterval(()=>{on=!on;gain.gain.value=on?1:0;},500);
    alarm.current={ctx,osc,timer};
   }catch{try{void ctx?.close();}catch{/* ignore */}}
  }
  try{
   const media=navigator.mediaDevices;
   if(!media?.getUserMedia)throw new Error('no camera');
   const s=await media.getUserMedia({video:{facingMode:'environment'}});
   if(run.current!==token){for(const track of s.getTracks())track.stop();return;}
   stream.current=s;
   const track=s.getVideoTracks()[0];
   await track.applyConstraints({advanced:[{torch:true} as MediaTrackConstraintSet]});
  }catch{
   if(run.current!==token)return;
   const s=stream.current;stream.current=null;if(s)for(const track of s.getTracks())try{track.stop();}catch{/* */}
   setFlashOn(true);setFlashing(true);
  }
 };
 // Built at tap time so the message carries when the person asked for help, not when the panel rendered.
 const buildMessage=()=>buildSosMessage({language,tags,lat:location?.lat??null,lng:location?.lng??null,accuracy_m:location?.accuracy_m??null,at:Date.now()});
 const message=buildMessage();
 const phones=profile.contacts.map(c=>c.phone);
 const canShare=typeof navigator!=='undefined'&&typeof navigator.share==='function';
 const share=()=>{void navigator.share({text:buildMessage()}).catch(()=>{/* user cancelled */});};
 return <section className={`sos-panel${pinned?' pinned':''}`} aria-labelledby="sos-title">
  <h2 id="sos-title">{t.title}</h2>
  <div className="sos-actions">
   <a className="button primary" href="tel:119">{t.call119}</a>
   <a className="button primary" href="tel:110">{t.call110}</a>
   {phones.length>0
    ?<a className="button" href={smsHref(phones,message)} onClick={e=>{e.currentTarget.href=smsHref(phones,buildMessage());}}>{t.message}</a>
    :canShare?<button type="button" onClick={share}>{t.share}</button>
    :<pre className="sos-message">{message}</pre>}
   {active
    ?<button type="button" className="danger" onClick={stopAll}>{t.stop}</button>
    :<button type="button" onClick={()=>void start()}>{t.alarm}</button>}
   {online
    ?<a href={NET119_URL} target="_blank" rel="noreferrer noopener">{t.net119}</a>
    :<span aria-disabled="true">{t.net119} — {t.needsNetwork}</span>}
  </div>
  <p>{t.battery}</p>
  {flashing&&<div data-testid="sos-flash" aria-hidden="true" style={{position:'fixed',inset:0,zIndex:2147483647,background:flashOn?'#fff':'#000',pointerEvents:'none'}}/>}
 </section>;
}
