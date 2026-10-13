'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import type {DistressStatus,DistressTag,Language} from '../lib/contracts';
import type {DesignatedPlace} from '../lib/designated-places';
import {distressText,emphasisText,formatClock,shouldPinSos,tagText} from '../lib/distress';
import {extractDistress,reportDistress,requestAdvice,type AppliedAdvice,type DistressInputMode,type DistressScope} from '../lib/distress-api';
import {applyDeadline,degradeExpiredOfficial,dropExcluded,effectiveDistressLevel,formatCountdown,orderCandidates,reachFor,reachKey,roundOrigin,skewedNow,speechLang,type DistressOrigin} from '../lib/distress-guidance';
import {adviceCandidates,DISTRESS_PARAMS,type TsunamiGuidance} from '../lib/distress-reachability';
import type {SosProfile} from '../lib/emergency-contacts';
import type {RoadGraphPack} from '../lib/evacuation-road-graph';
import {useDistressRecorder} from '../lib/use-distress-recorder';
import {SosPanel} from './sos-panel';
import './distress.css';

export type DistressSnapshot={distress:DistressStatus;session_id?:string;replay?:{id:string};situation?:{updated_at:string;latest_evidence_at?:string|null}}|null;
export type DistressPanelProps={snapshot:DistressSnapshot;language:Language;scope:DistressScope;accessKey?:string;
 /** Already freshness-checked device origin, or null. */
 location:DistressOrigin|null;
 /** null while the designated-place pack is loading. */
 places:readonly DesignatedPlace[]|null;
 /** undefined while loading; null when unavailable (straight-line estimate). */
 graph:RoadGraphPack|null|undefined;
 sosProfile:SosProfile;
 /** Raw server JSON; the caller parses it with its scope's snapshot schema. */
 onSnapshot:(raw:unknown)=>void;
 /** Logical clock (replay). Otherwise the device clock, floored by the snapshot's server time. */
 now?:number};
const TAGS:readonly DistressTag[]=['WATER_RISING','TRAPPED','INJURED','MOBILITY_LIMITED','WITH_DEPENDENTS','LOST_NO_DESTINATION','ROUTE_BLOCKED_REPORTED'];
const NONE:DistressStatus={level:'NONE',reports:[],trigger_evidence_ids:[],deadline_at:null,ai_escalated:false,synthetic:false,warning_class:null,last_official_at:null,trigger_expires_at:null};
const SPEECH_KEY='72h-distress-speech';
const unique=<T,>(xs:readonly T[])=>[...new Set(xs)];
function readSpeech(){try{return localStorage.getItem(SPEECH_KEY)!=='0';}catch{return true;}}
function say(text:string,language:Language){
 const synth=(globalThis as {speechSynthesis?:SpeechSynthesis}).speechSynthesis,U=(globalThis as {SpeechSynthesisUtterance?:typeof SpeechSynthesisUtterance}).SpeechSynthesisUtterance;
 if(!synth||!U)return;
 try{synth.cancel();const u=new U(text);u.lang=speechLang(language);synth.speak(u);}catch{/* speech is best effort */}
}
/** Runs after paint so up to 12 road searches never block the first frame. */
function defer(run:()=>void){
 const w=globalThis as {requestIdleCallback?:(cb:()=>void,o?:{timeout:number})=>number;cancelIdleCallback?:(id:number)=>void};
 if(typeof w.requestIdleCallback==='function'){const id=w.requestIdleCallback(run,{timeout:300});return()=>w.cancelIdleCallback?.(id);}
 const id=setTimeout(run,0);return()=>clearTimeout(id);
}

/** One primary instruction at a time. Level and instruction come only from snapshot.distress and deterministic reachability. */
export function DistressPanel(p:DistressPanelProps){
 const t=distressText[p.language],tt=tagText[p.language];
 const rawDistress=p.snapshot?.distress??NONE,sessionId=p.snapshot?.session_id??p.snapshot?.replay?.id??null;
 const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine!==false);
 const [wall,setWall]=useState(()=>Date.now());
 const [selected,setSelected]=useState<DistressTag[]>([]),[localTags,setLocalTags]=useState<DistressTag[]>([]);
 const [pending,setPending]=useState<{tags:DistressTag[];checked:DistressTag[];mode:'VOICE'|'TEXT'}|null>(null);
 const [hint,setHint]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[analyzing,setAnalyzing]=useState(false);
 const [speechOn,setSpeechOn]=useState(readSpeech);
 const [advice,setAdvice]=useState<{session:string;value:AppliedAdvice|null}|null>(null);
 const alive=useRef(true),requested=useRef(new Set<string>()),spoken=useRef<string|null>(null),onSnapshot=useRef(p.onSnapshot);onSnapshot.current=p.onSnapshot;
 useEffect(()=>{
  alive.current=true;
  const on=()=>setOnline(true),off=()=>setOnline(false),tick=setInterval(()=>setWall(Date.now()),1000);
  window.addEventListener('online',on);window.addEventListener('offline',off);
  return()=>{alive.current=false;clearInterval(tick);window.removeEventListener('online',on);window.removeEventListener('offline',off);};
 },[]);
 // A slow device clock must never add time: server time is a floor (live / mock-live).
 const serverAt=p.snapshot?.situation?Date.parse(p.snapshot.situation.updated_at):NaN,received=useRef<{at:number;wall:number}|null>(null);
 if(Number.isFinite(serverAt)&&received.current?.at!==serverAt)received.current={at:serverAt,wall:Date.now()};
 const now=p.now??skewedNow(wall,Number.isFinite(serverAt)?serverAt:null,received.current?.wall??null);
 // Past trigger_expires_at an OFFICIAL_TSUNAMI snapshot (e.g. cached offline) is shown as OFFICIAL_STALE: never "go to a site".
 const distress=degradeExpiredOfficial(rawDistress,now);
 const verifiedAt=p.snapshot?.situation?.latest_evidence_at??p.snapshot?.situation?.updated_at??null;
 const reported=useMemo(()=>unique([...distress.reports.flatMap(r=>r.tags),...localTags]),[distress.reports,localTags]);
 const level=effectiveDistressLevel(distress.level,localTags);
 const canAi=online&&!!sessionId&&!(p.scope==='mock-live'&&!p.accessKey);
 const current=advice&&advice.session===sessionId?advice.value:null,gemini=current?.mode==='GEMINI'?current:null;
 // Spec 13.3: AI exclusions apply only on the person's own blocked-route report or hint (the server also enforces this).
 const exclusionAllowed=reported.includes('ROUTE_BLOCKED_REPORTED')||!!hint?.trim();
 const excluded=useMemo(()=>exclusionAllowed?gemini?.excluded??[]:[],[gemini,exclusionAllowed]);
 const aiOff=!!advice&&advice.session===sessionId&&!gemini;

 // Reachability: memoized per (rounded origin, tags, excluded) and per places/graph identity; deadline applied cheaply every tick.
 const deadlineAt=distress.level==='OFFICIAL_TSUNAMI'&&distress.deadline_at?Date.parse(distress.deadline_at):null;
 const origin=roundOrigin(p.location);
 const key=deadlineAt!==null&&p.places!==null&&p.graph!==undefined?reachKey(origin,reported,excluded):null;
 const cache=useMemo(()=>new Map<string,TsunamiGuidance>(),[p.places,p.graph]);
 const tagsKey=[...reported].sort().join(',');
 const [reach,setReach]=useState<{key:string;tagsKey:string;cache:Map<string,TsunamiGuidance>;value:TsunamiGuidance}|null>(null);
 useEffect(()=>{
  if(!key||!p.places)return;
  const hit=cache.get(key);
  if(hit){setReach({key,tagsKey,cache,value:hit});return;}
  const places=p.places,graph=p.graph??null;
  return defer(()=>{const value=reachFor({origin,tags:reported,places,graph,excluded});cache.set(key,value);if(alive.current)setReach({key,tagsKey,cache,value});});
 // `key` encodes origin, tags and excluded.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,cache]);
 // While recomputing after a move or a new exclusion, keep the previous result (same places/graph, same tags, usable fix),
 // with current exclusions removed, so the instruction does not flash. Tag changes (e.g. slower walking) always wait.
 const exact=reach&&reach.key===key&&reach.cache===cache?reach.value:null;
 const reuse=!exact&&!!key&&!!reach&&reach.cache===cache&&reach.tagsKey===tagsKey&&!!origin&&origin.accuracy_m!==null&&origin.accuracy_m<=DISTRESS_PARAMS.maxAccuracyM;
 const reachValue=exact??(reuse&&reach?dropExcluded(reach.value,excluded):null);
 const guidance=deadlineAt===null?null:reachValue?applyDeadline(reachValue,deadlineAt,now)
  :deadlineAt<=now?applyDeadline({kind:'VERTICAL_NOW',reason:'NO_TIME',deadlineAt},deadlineAt,now):'PENDING' as const;
 // The primary site is always the deterministic first candidate (shortest walk). AI order only reorders the other candidates.
 const deterministic=guidance&&guidance!=='PENDING'&&guidance.kind==='GO_TO_SITE'?guidance.candidates:[];
 const first=deterministic[0]??null;
 const others=gemini?orderCandidates(deterministic.slice(1),gemini.candidate_order):deterministic.slice(1);
 const othersByAi=!!gemini&&gemini.candidate_order.length>0&&others.length>0;
 const kind=level==='NONE'?'NONE':guidance===null?'VERTICAL':guidance==='PENDING'?'PENDING':guidance.kind;
 const primaryText=kind==='NONE'?t.chooseSituation:kind==='GO_TO_SITE'&&first?t.goTo.replace('{name}',first.name):kind==='VERTICAL_NOW'?t.verticalNow:t.vertical;
 const aiInfluenced=!!gemini&&level==='OFFICIAL_TSUNAMI'&&guidance!=='PENDING'&&guidance!==null
  &&excluded.length>0;
 const officialLevel=distress.level==='OFFICIAL_TSUNAMI'||distress.level==='OFFICIAL_STALE';
 const lastOfficial=officialLevel&&distress.last_official_at?Date.parse(distress.last_official_at):NaN;
 const officialTime=Number.isFinite(lastOfficial)?formatClock(lastOfficial):'--:--';
 const warningName=distress.warning_class==='MAJOR_WARNING'?t.warningMajor:distress.warning_class==='WARNING'?t.warningWarning:null;
 const basis=officialLevel&&warningName&&Number.isFinite(lastOfficial)?t.basis.replace('{warning}',warningName).replace('{time}',officialTime):null;
 const staleNotice=distress.level==='OFFICIAL_STALE'?t.staleNotice.replace('{time}',officialTime):null;
 const reason=guidance&&guidance!=='PENDING'&&guidance.kind==='VERTICAL_NOW'
  ?{NO_TIME:t.reasonNoTime,NO_LOCATION:t.reasonNoLocation,NO_REACHABLE_SITE:t.reasonNoReachable,NO_SITES_IN_PACK:t.reasonNoSites,EXCLUDED_BY_REPORT:t.reasonExcludedByReport}[guidance.reason]:null;

 // Read aloud once per instruction change.
 const speechKey=`${level}|${kind}|${first?.place_id??''}`;
 useEffect(()=>{
  if(kind==='NONE'||kind==='PENDING'||spoken.current===speechKey)return;
  spoken.current=speechKey;if(speechOn)say(primaryText,p.language);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[speechKey]);
 const toggleSpeech=()=>{
  const next=!speechOn;setSpeechOn(next);
  try{localStorage.setItem(SPEECH_KEY,next?'1':'0');}catch{/* per-device convenience only */}
  if(!next)try{(globalThis as {speechSynthesis?:SpeechSynthesis}).speechSynthesis?.cancel();}catch{/* */}
 };

 // AI advice: once per (session, level, confirmed tags, hint), after deterministic candidates exist. The server decides any level raise.
 useEffect(()=>{
  if(level==='NONE'||!canAi||!sessionId||guidance==='PENDING')return;
  const id=`${sessionId}|${level}|${[...reported].sort().join(',')}|${hint??''}`;
  if(requested.current.has(id))return;requested.current.add(id);
  void requestAdvice(p.scope,sessionId,{language:p.language,candidates:guidance?adviceCandidates(guidance):[],route_blocked_hint:hint},p.accessKey).then(res=>{
   if(!alive.current)return;
   setAdvice({session:sessionId,value:res?.advice??null});
   if(res)onSnapshot.current(res.snapshot);
  });
 });

 const submit=async(tags:DistressTag[],mode:DistressInputMode)=>{
  if(!tags.length)return;
  setLocalTags(prev=>unique([...prev,...tags]));setNotice(null);
  if(!online||!sessionId||(p.scope==='mock-live'&&!p.accessKey))return;
  setBusy(true);const raw=await reportDistress(p.scope,sessionId,tags,mode,p.accessKey);
  if(!alive.current)return;setBusy(false);
  if(raw===null)setNotice(t.sendFailed);else onSnapshot.current(raw);
 };
 const analyze=async(input:{text?:string;audio?:Blob},mode:'VOICE'|'TEXT')=>{
  if(!canAi||!sessionId)return;
  setBusy(true);setAnalyzing(true);setNotice(null);const r=await extractDistress({sessionId,language:p.language,...input});
  if(!alive.current)return;setBusy(false);setAnalyzing(false);
  if(!r||(!r.tags.length&&!r.hint)){setNotice(t.extractFailed);return;}
  setPending({tags:r.tags,checked:[],mode});setHint(r.hint);
 };
 const recorder=useDistressRecorder(blob=>void analyze({audio:blob},'VOICE'));
 const confirm=()=>{
  if(!pending)return;const tags=unique([...selected,...pending.checked]);if(!tags.length)return;
  setPending(null);setSelected([]);void submit(tags,pending.mode);
 };
 const toggle=(tag:DistressTag)=>setSelected(s=>s.includes(tag)?s.filter(x=>x!==tag):[...s,tag]);
 const pinned=shouldPinSos(reported,p.sosProfile,level)||!!gemini?.suggest_sos;
 const sos=<>
  {gemini?.suggest_sos&&<p className="distress-ai-note"><span className="distress-ai" data-testid="distress-sos-ai">{t.aiSuggestion}</span> {t.sosSuggested}</p>}
  <SosPanel language={p.language} profile={p.sosProfile} tags={unique([...reported,...selected])} location={p.location} pinned={pinned}/>
 </>;

 return <section className="distress-panel" aria-label={t.chooseSituation}>
  {distress.synthetic&&<p className="distress-exercise" data-testid="distress-exercise">{t.exercise}</p>}
  {!online&&<p className="distress-offline" role="status">{t.offlineReason}{verifiedAt&&<span data-testid="distress-last-verified"> {t.lastVerified}: {new Date(verifiedAt).toLocaleString(p.language)}</span>}</p>}
  {pinned&&sos}
  <div className="distress-primary" data-testid="distress-primary">
   <p className="distress-primary-text" aria-live="assertive">{primaryText}{aiInfluenced&&<span className="distress-ai" data-testid="distress-ai-label">{t.aiSuggestion}</span>}</p>
   {staleNotice&&<p className="distress-stale" role="status" data-testid="distress-stale">{staleNotice}</p>}
   {basis&&<p className="distress-basis" data-testid="distress-basis">{basis}</p>}
   {kind==='GO_TO_SITE'&&first&&<p>{t.walkMeta.replace('{min}',String(Math.ceil(first.walk_seconds/60))).replace('{m}',String(Math.round(first.distance_m)))}</p>}
   {deadlineAt!==null&&deadlineAt>now&&<p className="distress-countdown" role="timer" aria-live="off">{t.countdown} <strong>{formatCountdown(deadlineAt-now)}</strong></p>}
   {kind==='GO_TO_SITE'&&<p>{t.roadCandidateNotice}</p>}
   {kind==='PENDING'&&<p>{t.computing}</p>}
   {reason&&<p>{reason}</p>}
   {kind==='NONE'&&<Link href="/map#evacuation-routes">{t.officialSites} →</Link>}
   <small data-testid="distress-disclaimer">{t.notGuaranteed}</small>
  </div>
  <div className="distress-speech">
   <button type="button" disabled={kind==='NONE'} onClick={()=>say(primaryText,p.language)}>{t.replay}</button>
   <button type="button" aria-pressed={!speechOn} onClick={toggleSpeech}>{speechOn?t.mute:t.speak}</button>
  </div>
  {aiOff&&<small className="distress-ai-off">{t.aiUnavailable}</small>}
  {!!gemini?.emphasis_clause_ids.length&&<ul className="distress-emphasis">{gemini.emphasis_clause_ids.map(id=><li key={id}><span className="distress-ai">{t.aiSuggestion}</span> {emphasisText[p.language][id]}</li>)}</ul>}
  <div className="distress-tags" role="group" aria-label={t.chooseSituation}>
   {TAGS.map(tag=><button key={tag} type="button" aria-pressed={selected.includes(tag)} onClick={()=>toggle(tag)}>{tt[tag]}</button>)}
  </div>
  <button type="button" className="distress-send" disabled={!selected.length||busy} onClick={()=>{const tags=selected;setSelected([]);void submit(tags,'BUTTON');}}>{t.send}</button>
  <div className="distress-voice">
   {recorder.recording
    ?<button type="button" className="danger" onClick={recorder.stop}>{t.stopRecording}</button>
    :<button type="button" disabled={!canAi||busy||recorder.starting} onClick={()=>void recorder.start()}>{t.record}</button>}
   {!online?<small>{t.voiceNeedsNetwork}</small>:!canAi?<small>{t.noSession}</small>:null}
   {recorder.failed&&<small role="status">{t.micUnavailable}</small>}
   {analyzing&&<small role="status">{t.analyzing}</small>}
  </div>
  <details className="distress-type"><summary>{t.typeInstead}</summary>
   <textarea maxLength={500} value={text} onChange={e=>setText(e.target.value)} aria-label={t.typeInstead}/>
   <button type="button" disabled={!canAi||busy||!text.trim()} onClick={()=>void analyze({text},'TEXT')}>{t.analyze}</button>
  </details>
  {notice&&<p role="status">{notice}</p>}
  {pending&&<fieldset className="distress-pending"><legend>{t.pendingTags}</legend>
   {pending.tags.map(tag=><label key={tag}><input type="checkbox" checked={pending.checked.includes(tag)}
    onChange={()=>setPending(v=>v&&{...v,checked:v.checked.includes(tag)?v.checked.filter(x=>x!==tag):[...v.checked,tag]})}/> {tt[tag]}</label>)}
   {hint&&<p>{t.aiHeard}「{hint}」</p>}
   <button type="button" className="distress-send" disabled={busy||!unique([...selected,...pending.checked]).length} onClick={confirm}>{t.confirm}</button>
  </fieldset>}
  {!pinned&&sos}
  <details className="distress-details"><summary>{t.moreDetails}</summary>
   {others.length>0&&<><p>{t.otherCandidates}{othersByAi&&<> <span className="distress-ai" data-testid="distress-other-ai">{t.aiSuggestion}</span></>}</p><ul>{others.map(c=><li key={c.place_id}>{c.name} · {t.walkMeta.replace('{min}',String(Math.ceil(c.walk_seconds/60))).replace('{m}',String(Math.round(c.distance_m)))}</li>)}</ul></>}
   {!!reported.length&&<p>{t.lastReport}: {reported.map(x=>tt[x]).join('、')}</p>}
   {kind!=='NONE'&&<Link href="/map#evacuation-routes">{t.officialSites} →</Link>}
  </details>
 </section>;
}
