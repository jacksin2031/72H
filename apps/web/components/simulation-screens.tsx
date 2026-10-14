'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Language } from '@/lib/contracts';
import { jstInputFromEpoch } from '@/lib/historical-playback';
import type { SimulationLaunch } from '@/lib/simulation-session';
import { mockLiveResponseSchema, type MockLiveResponse } from '@/lib/mock-live-envelope';
import { DistressEntry } from './distress-entry';
import { SimulationReferenceMap } from './simulation-reference-map';
import { SimulationRiskPanel } from './simulation-risk-panel';
import { useSimulationGeo } from '@/lib/use-simulation-geo';
import { epicenterForPlayedMilestones, historicTsunamiWarningStarted, screenGeoExposure } from '@/lib/geospatial-exposure';
import { seismicOriginsForMilestones } from '@/lib/seismic-wavefront';
import { activeSimulationAdvice, simulationAdviceText } from '@/lib/simulation-advice';
import { SimulationAdvicePanel } from './simulation-advice-panel';
import { PlanExplanationPanel } from './plan-explanation-panel';
import { AppShell, Button, Disclosure, ListRow, Section, StatusBand } from './ui';
import { NowScreen } from './now-screen';
import { HelpOverlay } from './help-overlay';
import { liveMessages } from '@/lib/live-i18n';
import { MapScreen } from './map-screen';
import { MAP_REGIONS, mapOverviewLabel, mapRegionLabel } from '@/lib/map-regions';
import { sosText } from '@/lib/distress';
import type { AppTab } from '@/lib/app-tabs';

/** home / plan / events all render the shared Now screen (events opens its basis on the timeline); map and more use the shared Map and More layouts. */
export type SimulationSection = 'home' | 'plan' | 'events' | 'map' | 'more';
type Stage = 'waiting' | 'processing' | 'running' | 'completed' | 'failed';

const ui = {
  ja: { exercise:'演習', more:'その他',close:'演習を終了',
    warning:'演習画面 · 実際の警報ではありません', clock:'演習時刻',before:'地震発生まで', nextEvent:'次のイベント',
    timeline:'時系列',eventDone:'処理済み',upcoming:'未発生',
    awaiting:'演習が始まる前です。周囲を確認し、落ち着いて準備してください。',waiting:'AI / Safety Core の判定を待っています',
    unsupported:'歴史的参考情報のみ · 安全判断の対象外', earthquake:'地震発生', note:'国土地理院の日本全国参考地図です。海岸線は浸水や安全経路を示しません。',
    safety:'GPS地域は任意設定。実際の通知・移動許可はありません',
    details:'演習の詳細（AI / Safety Core）', ai:'AI / Safety Core',
    consult:'史料', actions:'行動プラン', source:'模擬ソース', status:'ステータス', simulationOnly:'演習のみ',
    pending:'イベント発生を待っています', processing:'模擬イベントを処理中…', completed:'完了',
    risk:'歴史の津波警報・停電は時系列のみです。危険エリア、避難所、経路を推定表示しません。',
    error:'演習エラー', mapNotice:'安全な経路・避難所の認証なし',
    mapRiskTitle:'位置とリスク',mapRiskUnknown:'安全性：判定不能',tsunamiWarningSummary:'津波警報（歴史演習） · 避難安全性は未判定',
  },
  en: { exercise:'Exercise', more:'More',close:'End drill',
    warning:'SIMULATION · Not a live alert',clock:'Simulation time',before:'Until the earthquake',nextEvent:'Next event',
    timeline:'Timeline',eventDone:'Processed',upcoming:'Not yet',
    awaiting:'The drill has not reached the event. Stay ready and monitor surroundings.',waiting:'AI / Safety Core decision pending',
    unsupported:'Historical context only · no hazard assessment',earthquake:'Earthquake event',note:'Nationwide GSI reference map. Coastline is NOT an inundation or safe-route boundary.',
    safety:'GPS area is optional. No actual alerts or movement authorization',
    details:'Exercise details (AI / Safety Core)', ai:'AI / Safety Core',
    consult:'Historic source',actions:'Action plan',source:'Simulated source',status:'Status', simulationOnly:'Simulation only',
    pending:'Waiting for a simulated event',processing:'Processing simulated event…',completed:'Completed',
    risk:'Tsunami and outage entries are historical context only. No inferred hazards, shelters or safe routes are displayed.',
    error:'Exercise error',mapNotice:'No verified shelter or safe route',
    mapRiskTitle:'Location & risk',mapRiskUnknown:'Safety: undetermined',tsunamiWarningSummary:'Historic tsunami warning · safety not verified',
  },
  'zh-TW': { exercise:'演練', more:'更多',close:'結束演習',
    warning:'模擬演習 · 並非真實警報',clock:'模擬時間',before:'距離地震發生',nextEvent:'下一事件',
    timeline:'時間線',eventDone:'已處理',upcoming:'未發生',
    awaiting:'尚未到達模擬災難時間，請留意周圍環境並保持準備。',waiting:'等待 AI／Safety Core 判斷',
    unsupported:'僅作歷史背景 · 不屬安全判斷',earthquake:'地震發生',note:'全日本國土地理院參考地圖，海岸線不是海嘯浸水或避難安全邊界。',
    safety:'可自選 GPS 地區；不發出真實通知或移動授權',
    details:'演練詳細（AI／Safety Core）', ai:'AI／Safety Core',
    consult:'歷史來源',actions:'行動計劃',source:'模擬來源',status:'狀態', simulationOnly:'僅限演練',
    pending:'等待模擬事件發生',processing:'正在處理模擬事件…',completed:'已完成',
    risk:'海嘯警報及停電只是歷史背景，不會推算危險區域、避難所或安全路線。',
    error:'演習出現錯誤',mapNotice:'沒有已核實避難所或安全路線',
    mapRiskTitle:'定位與災害風險',mapRiskUnknown:'安全性：無法判定',tsunamiWarningSummary:'歷史海嘯警報已發生 · 尚未確認避難安全',
  },
} as const;

const count = (seconds: number) => {
  const s = Math.max(0,Math.ceil(seconds));
  return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');
};
const tabFor=(tab:SimulationSection):AppTab=>tab==='map'?'map':tab==='more'?'more':'now';

type Props = {
  config: SimulationLaunch; phase: Stage; tab: SimulationSection;
  setTab: Dispatch<SetStateAction<SimulationSection>>;
  time: number; speed: number; state: MockLiveResponse | null;
  done: number; processing: boolean; error: string; leave: () => void;
  /** Adopts a validated distress/advice response for the same exercise session. */
  onState?: (next: MockLiveResponse) => void;
};

export function SimulationScreens({config,phase,tab,setTab,time,speed,state,done,processing,error,leave,onState}:Props) {
  const language:Language = config.language;
  const t=ui[language];
  const [wallTime,setWallTime]=useState(()=>Date.now());
  const [connected,setConnected]=useState(()=>typeof navigator==='undefined'||navigator.onLine);
  const [lastDisconnect,setLastDisconnect]=useState(0);
  const [distressOpen,setDistressOpen]=useState(false);
  const [regionRequest,setRegionRequest]=useState<{value:string}|null>(null);
  useEffect(()=>{
    const tick=setInterval(()=>setWallTime(Date.now()),1000);
    const online=()=>{setConnected(true);setWallTime(Date.now());};const offline=()=>{setConnected(false);setLastDisconnect(Date.now());};
    window.addEventListener('online',online);window.addEventListener('offline',offline);
    return()=>{clearInterval(tick);window.removeEventListener('online',online);window.removeEventListener('offline',offline);};
  },[]);
  const geo=useSimulationGeo();
  const seismicOrigins=useMemo(()=>seismicOriginsForMilestones(config.historicalCase,config.milestones),[config.historicalCase,config.milestones]);
  const occurredOrigins=seismicOrigins.filter(origin=>Date.parse(origin.observed_at_jst)<=time);
  const epicenter=occurredOrigins.at(-1)??epicenterForPlayedMilestones(config.historicalCase,config.milestones,done);
  const warning=historicTsunamiWarningStarted(config.milestones,done);
  const assessment=screenGeoExposure({location:geo.location,epicenter,tsunamiWarningActive:warning,now:Date.now()});
  const current=config.milestones[Math.max(0,done-1)]??null;
  const upcoming=config.milestones[done]??null;
  const seconds=upcoming?Math.max(0,(Date.parse(upcoming.at_jst)-time)/1000):0;
  const plan=state?.snapshot.plans.find(p=>p.id===state.snapshot.situation.current_plan_id);
  const actions=state?.snapshot.plan_actions.filter(a=>a.plan_id===plan?.id && a.status==='ACTIVE')??[];
  const byCategory=(category:'NOW'|'NEXT'|'AVOID')=>actions.filter(a=>a.category===category).map(a=>a.text);
  const advice=state?activeSimulationAdvice(state.movement_assessment,{session_id:state.snapshot.session_id,step:state.current_step,
    plan_id:state.snapshot.situation.current_plan_id},connected&&config.input.network==='ONLINE'&&!processing&&phase!=='failed'
      &&Date.parse(state.movement_assessment?.created_at??'')>lastDisconnect,wallTime):null;
  const adviceText=simulationAdviceText[language];
  const lastMode=state?.movement_assessment?.ai_mode;
  const ai=(state?.movement_assessment&&!advice&&lastMode!=='NOT_RUN'?(language==='zh-TW'?'最近一次執行：':language==='ja'?'直近の実行：':'Last execution: '):'')
    +(lastMode==='GEMINI_ADK'?adviceText.success:lastMode==='GEMINI_ADK_FALLBACK'?adviceText.fallback:adviceText.notRun);
  const doneEvent=done>0;
  const timeText=jstInputFromEpoch(time).replace('T',' ')+':'+new Date(time).toISOString().slice(17,19);
  // The played tsunami milestone names the level on the band, exactly like Live's danger band (演練 · <level>).
  const warningLabel=warning?config.milestones.slice(0,done).findLast(m=>m.kind==='TSUNAMI_WARNING')?.label[language]??t.tsunamiWarningSummary:null;

  const offlineExercise = !connected || config.input.network !== 'ONLINE';
  const band=offlineExercise
    ?<StatusBand tone="warn" label={`${t.exercise} · ${liveMessages[language].nowOfflineVerified} ${state?.snapshot.situation.latest_evidence_at ? new Date(state.snapshot.situation.latest_evidence_at).toLocaleString(language,{timeZone:'Asia/Tokyo'}) : '—'}`}/>
    :warningLabel
    ?<StatusBand tone="danger" label={`${t.exercise} · ${warningLabel}`}/>
    :<StatusBand tone="exercise" label={upcoming?`${t.exercise} · ${doneEvent?t.nextEvent:t.before}`:t.exercise} countdown={upcoming?count(seconds):null}/>;
  const exerciseControls=<>
    <span className="ui-exercise-meta" data-testid="simulation-clock">{timeText.slice(11)} JST</span>
    <span className="ui-exercise-meta">{speed}× · {done} / {config.milestones.length}</span>
    {processing&&<span className="ui-exercise-meta" role="status">{t.processing}</span>}
    {phase==='completed'&&<span className="ui-exercise-meta" role="status" data-testid="simulation-complete">{t.completed}</span>}
    <Button variant="secondary" onClick={leave}>{t.close}</Button>
  </>;

  const errorLine=error?<p role="alert" className="error">{t.error}: {error}</p>:null;
  const fix=geo.location?{lat:geo.location.lat,lng:geo.location.lng,accuracy_m:geo.location.accuracy_m,captured_at:geo.location.captured_at,manual:geo.location.source==='MANUAL_EXERCISE'}:null;
  const hero=!doneEvent?t.awaiting:config.conditions?adviceText[advice?.decision??'UNKNOWN']:byCategory('NOW').join(' · ')||t.waiting;
  const basis=doneEvent&&current
    ?`${current.kind==='EARTHQUAKE'?t.earthquake:current.label[language]} · ${current.at_jst.slice(11,16)} · ${config.title}${current.fed_to_safety_core?'':' · '+t.unsupported}`
    :`${config.title}${upcoming?` · ${t.nextEvent} ${upcoming.at_jst.slice(11,16)} ${upcoming.label[language]}`:''}`;
  const basisDetails=<>
    <p className="now-meta">{t.warning}</p>
    <Section title={t.timeline}><ol className="ui-exercise-list" data-testid="simulation-timeline">{config.milestones.map((m,i)=><li key={m.at_jst+'-'+i} data-event-state={i<done?'processed':'pending'}>
      {m.at_jst.slice(11,16)} · {m.label[language]}
      <small>{i<done?t.eventDone:i===done?t.nextEvent:t.upcoming} · {m.fed_to_safety_core?t.ai:t.unsupported} · <a href={m.source_url} rel="noopener noreferrer" target="_blank">{t.consult} ↗</a></small>
    </li>)}</ol><p className="now-meta">{t.risk}</p></Section>
    <Section title={`${t.source} (${state?.snapshot.evidence.length??0})`}>
      {state?.snapshot.evidence.length?<ul className="ui-exercise-list">{state.snapshot.evidence.map(e=><li key={e.id}>{e.source_name} · {e.summary}</li>)}</ul>:<p className="now-meta">{t.pending}</p>}
    </Section>
    {state&&<PlanExplanationPanel snapshot={state.snapshot} language={language} scope="mock-live" accessKey={config.accessKey} enabled={connected&&!processing&&phase!=='failed'&&config.input.network==='ONLINE'}/>}
    <Disclosure summary={t.details} id="exercise-details"><p className="now-meta">{t.ai} · {doneEvent?ai:t.pending}</p></Disclosure>
  </>;
  const help=<>
    {doneEvent&&<SimulationAdvicePanel advice={advice} executionMode={lastMode} language={language} cannotMove={config.input.mobility==='CANNOT_MOVE'} stale={Boolean(state?.movement_assessment&&!advice)}/>}
    {<>
      <Button variant="danger" className="distress-entry-button" aria-expanded={distressOpen} onClick={()=>setDistressOpen(open=>!open)}>{sosText[language].title}</Button>

    </>}
  </>;

  const screen=tab==='map'
    ?<div data-testid="simulation-map-screen"><MapScreen language={language} keepSheetMounted={false}
      map={<SimulationReferenceMap language={language} showInformation={false} legend="none" regionPicker={false} regionRequest={regionRequest}
        userLocation={assessment.user_location} epicenter={epicenter} seismicOrigins={seismicOrigins} seismicTime={time}/>}
      region={<select aria-label={mapRegionLabel(language)} defaultValue="" onChange={event=>setRegionRequest({value:event.target.value})}>
        <option value="">{mapOverviewLabel(language)}</option>
        {MAP_REGIONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
      </select>}
      layers={[]} legend={t.note} routeSection={null}
      peek={`${warning?t.tsunamiWarningSummary:t.mapNotice} · ${t.mapRiskUnknown}`}
      sections={[{title:t.mapRiskTitle,content:<>
        <SimulationRiskPanel language={language} assessment={assessment} gpsState={geo.state} gpsError={geo.error} requestLocation={geo.request} clearLocation={geo.clear}/>
        <p className="now-meta">{t.risk}</p>
      </>}]}/></div>
    :tab==='more'
      ?<div data-testid="simulation-settings"><h1 className="more-title">{t.more}</h1>
        <ListRow label={t.status} value={t.simulationOnly} trailing="none"/>
        <ListRow label={t.clock} value={timeText} trailing="none"/>
        <ListRow label={t.actions} value={config.title} trailing="none"/>
        <p className="now-meta">{t.warning} · {t.safety}</p>
        <Disclosure summary={t.details}><p className="now-meta">{t.ai} · {ai}</p></Disclosure>
      </div>
      :<div data-testid="simulation-now"><NowScreen language={language} hero={hero} heroTone={warningLabel?'danger':error||!connected?'warn':'normal'} basis={basis}
        next={doneEvent?byCategory('NEXT'):[]} avoid={doneEvent?byCategory('AVOID'):[]}
        updatedLabel={`${t.clock} ${timeText.slice(0,16)} JST`} note={liveMessages[language].notSafetyVerdict} exercise openBasis={tab==='events'} basisDetails={basisDetails} help={help}/></div>;

  return <div data-testid="simulation-dashboard">
    <AppShell tab={tabFor(tab)} language={language} band={band} exerciseControls={exerciseControls} fullBleed={tab==='map'}
      onTab={next=>setTab(next==='map'?'map':next==='more'?'more':'home')}>
      {errorLine}
      <button type="button" hidden={tab==='home'||tab==='plan'||tab==='events'||distressOpen} className="ui-help-pin" aria-label={sosText[language].title} onClick={()=>setDistressOpen(true)}>{sosText[language].title}</button>
      {distressOpen&&<HelpOverlay language={language} onClose={()=>setDistressOpen(false)}><DistressEntry snapshot={state?.snapshot??null} language={language} scope="mock-live" accessKey={config.accessKey} fix={fix}
        onSnapshot={raw=>{const parsed=mockLiveResponseSchema.safeParse(raw);if(parsed.success&&state&&parsed.data.snapshot.session_id===state.snapshot.session_id&&parsed.data.current_step>=state.current_step)onState?.(parsed.data);}}/></HelpOverlay>}
      {screen}
    </AppShell>
  </div>;
}
