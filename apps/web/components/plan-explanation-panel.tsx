'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import type {Language} from '@/lib/contracts';
import {boundedText} from '@/lib/disaster-map';
import {EXPLAINABLE_DECISIONS,acceptPlanExplanation,explanationText,planExplanationKey,type ExplanationSnapshot,type PlanExplanation} from '@/lib/plan-explanation';
import './plan-explanation.css';

export function PlanExplanationPanel({snapshot,language,scope='live',accessKey,enabled=true}:{snapshot:ExplanationSnapshot&{session_id?:string;session?:{id:string}};
 language:Language;scope?:'live'|'replay'|'mock-live';accessKey?:string;enabled?:boolean}){
 const t=explanationText[language],key=planExplanationKey(snapshot),sessionId=snapshot.session_id??snapshot.session?.id;
 const latest=useRef(snapshot);latest.current=snapshot;
 const [result,setResult]=useState<{key:string;language:Language;data:PlanExplanation}|null>(null),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 const [now,setNow]=useState(()=>Date.now()),[online,setOnline]=useState(()=>typeof navigator!=='undefined'&&navigator.onLine);
 const plan=snapshot.plans.find(p=>p.id===snapshot.situation.current_plan_id),active=plan?.status==='ACTIVE';
 useEffect(()=>{
  const offline=()=>{setOnline(false);setResult(null);},on=()=>{setOnline(true);setResult(null);};
  window.addEventListener('offline',offline);window.addEventListener('online',on);const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',on);clearInterval(timer);};
 },[]);
 useEffect(()=>{
  const controller=new AbortController();setResult(null);
  if(!enabled||!online||!active||!sessionId||!['ONLINE_VERIFIED','ONLINE_DEGRADED'].includes(snapshot.situation.network_state)||(scope==='mock-live'&&!accessKey)){setLoading(false);return;}
  setLoading(true);
  void (async()=>{
   try{
    const response=await fetch(`/api/${scope}/${encodeURIComponent(sessionId)}/explanation`,{method:'POST',cache:'no-store',
     headers:{'Content-Type':'application/json',...(scope==='mock-live'?{'X-Drill-Key':accessKey!}:{})},body:JSON.stringify({language}),
     signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
    const raw=JSON.parse((await boundedText(response,64000)).text),data=acceptPlanExplanation(raw,latest.current,language,Date.now());
    if(!controller.signal.aborted&&navigator.onLine&&key===planExplanationKey(latest.current)&&data)setResult({key,language,data});
   }catch{/* Deterministic current-plan fallback. */}
   finally{if(!controller.signal.aborted)setLoading(false);}
  })();
  return()=>controller.abort();
 // The key captures approval, evidence, language, version and network mutations.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,language,scope,sessionId,accessKey,enabled,online,active,attempt]);
 const data=enabled&&online&&result?.key===key&&result.language===language?acceptPlanExplanation(result.data,snapshot,language,now):null;
 const actions=active?snapshot.plan_actions.filter(a=>a.plan_id===plan.id&&a.status==='ACTIVE'&&EXPLAINABLE_DECISIONS.includes(a.safety_decision)):[];
 return <section className="plan-explanation-panel" data-testid="plan-explanation-panel" aria-live="polite">
  <h2>{t.title}</h2><small data-testid="plan-explanation-mode">{loading?t.loading:data?.mode==='GEMINI_ADK_EXPLANATION'?t.ai:t.fallback}</small>
  {data?data.paragraphs.map((p,i)=><p key={i}>{p}</p>):actions.length?actions.map(a=><p key={a.id}><strong>{a.category}</strong> · {a.reason}</p>):<p>{t.noPlan}</p>}
  <details><summary>{t.limits}</summary><p>{t.scope}</p>{!data&&<p>{t.stale}</p>}
   {data?.limitations.map((p,i)=><p key={i}>{p}</p>)}{data&&<small>v{data.plan_version} · {new Date(data.expires_at).toLocaleTimeString(language)} · {data.reason_code??''}</small>}
   {!!data?.evidence_ids.length&&<p>{t.sources}: {data.evidence_ids.join(', ')}</p>}
  </details>
  <button type="button" disabled={loading||!enabled||!online||!active||!['ONLINE_VERIFIED','ONLINE_DEGRADED'].includes(snapshot.situation.network_state)} onClick={()=>setAttempt(n=>n+1)}>{t.retry}</button>
  <Link href="/map#evacuation-routes">{t.routes} →</Link>
 </section>;
}
