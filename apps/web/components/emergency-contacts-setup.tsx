'use client';
import {useRef,useState} from 'react';
import type {Language} from '../lib/contracts';
import {sosText} from '../lib/distress';
import {SOS_ONBOARDED_KEY,saveSosProfile,validateContact,type EmergencyContact} from '../lib/emergency-contacts';

function markOnboarded(){try{localStorage.setItem(SOS_ONBOARDED_KEY,'1');}catch{/* storage unavailable */}}

export function EmergencyContactsSetup({language,onDone}:{language:Language;onDone:()=>void}){
 const t=sosText[language];
 const [rows,setRows]=useState([0,1,2].map(()=>({name:'',phone:''})));
 const [mobility,setMobility]=useState(false),[assist,setAssist]=useState(false),[failed,setFailed]=useState(false);
 const playing=useRef(false);
 const filled=rows.filter(r=>r.name.trim()||r.phone.trim());
 const canSave=filled.every(r=>validateContact(r));
 const update=(i:number,key:'name'|'phone',value:string)=>setRows(prev=>prev.map((r,j)=>j===i?{...r,[key]:value}:r));
 const testAlarm=()=>{
  if(playing.current)return;
  try{
   const Ctor=(globalThis as unknown as {AudioContext?:typeof AudioContext}).AudioContext;if(!Ctor)return;
   const ctx=new Ctor(),osc=ctx.createOscillator();osc.frequency.value=880;osc.connect(ctx.destination);osc.start();playing.current=true;
   setTimeout(()=>{try{osc.stop();void ctx.close();}catch{/* already stopped */}playing.current=false;},1000);
  }catch{playing.current=false;}
 };
 const save=async()=>{
  const contacts=filled.map(validateContact).filter((c):c is EmergencyContact=>!!c);
  if(!(await saveSosProfile({contacts,needsAssistance:assist,mobilityLimited:mobility}))){setFailed(true);return;}
  markOnboarded();onDone();
 };
 const skip=()=>{markOnboarded();onDone();};
 return <section className="emergency-contacts-setup" aria-labelledby="sos-setup-title">
  <h2 id="sos-setup-title">{t.setupTitle}</h2>
  <p>{t.battery}</p>
  {rows.map((r,i)=><div key={i} className="sos-contact-row">
   <label>{t.name}<input value={r.name} maxLength={40} autoComplete="off" onChange={e=>update(i,'name',e.target.value)}/></label>
   <label>{t.phone}<input value={r.phone} type="tel" inputMode="tel" autoComplete="off" aria-invalid={!!r.phone.trim()&&!validateContact({name:r.name.trim()||'x',phone:r.phone})} onChange={e=>update(i,'phone',e.target.value)}/></label>
  </div>)}
  <label><input type="checkbox" checked={mobility} onChange={e=>setMobility(e.target.checked)}/> {t.mobility}</label>
  <label><input type="checkbox" checked={assist} onChange={e=>setAssist(e.target.checked)}/> {t.assist}</label>
  {failed&&<p role="alert">{t.saveFailed}</p>}
  <div className="onboarding-actions">
   <button type="button" onClick={testAlarm}>{t.testAlarm}</button>
   <button type="button" className="primary" disabled={!canSave} onClick={()=>void save()}>{t.save}</button>
   <button type="button" onClick={skip}>{t.skip}</button>
  </div>
 </section>;
}
