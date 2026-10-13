'use client';
import {useEffect,useRef,useState} from 'react';
import type {Language} from '../lib/contracts';
import {sosText} from '../lib/distress';
import {SOS_ONBOARDED_KEY,saveSosProfile,validateContact,type EmergencyContact} from '../lib/emergency-contacts';

function markOnboarded(){try{localStorage.setItem(SOS_ONBOARDED_KEY,'1');}catch{/* storage unavailable */}}

export function EmergencyContactsSetup({language,onDone}:{language:Language;onDone:()=>void}){
 const t=sosText[language];
 const [rows,setRows]=useState([0,1,2].map(()=>({name:'',phone:''})));
 const [mobility,setMobility]=useState(false),[assist,setAssist]=useState(false),[failed,setFailed]=useState(false);
 const alarm=useRef<{ctx:AudioContext;osc:OscillatorNode;timer:ReturnType<typeof setTimeout>}|null>(null);
 const filled=rows.filter(r=>r.name.trim()||r.phone.trim());
 const canSave=filled.every(r=>validateContact(r));
 const update=(i:number,key:'name'|'phone',value:string)=>setRows(prev=>prev.map((r,j)=>j===i?{...r,[key]:value}:r));
 const stopAlarm=()=>{
  const a=alarm.current;if(!a)return;alarm.current=null;clearTimeout(a.timer);
  try{a.osc.stop();}catch{/* already stopped */}
  try{void a.ctx.close();}catch{/* already closed */}
 };
 useEffect(()=>stopAlarm,[]);
 const testAlarm=()=>{
  if(alarm.current)return;
  const Ctor=(globalThis as unknown as {AudioContext?:typeof AudioContext}).AudioContext;if(!Ctor)return;
  let ctx:AudioContext|null=null;
  try{
   ctx=new Ctor();const osc=ctx.createOscillator();osc.frequency.value=880;osc.connect(ctx.destination);
   alarm.current={ctx,osc,timer:setTimeout(stopAlarm,1000)};osc.start();
  }catch{stopAlarm();try{void ctx?.close();}catch{/* ignore */}}
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
