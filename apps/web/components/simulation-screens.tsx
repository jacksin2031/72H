'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Language } from '@/lib/contracts';
import { jstInputFromEpoch } from '@/lib/historical-playback';
import type { SimulationLaunch } from '@/lib/simulation-session';
import type { MockLiveResponse } from '@/lib/mock-live-envelope';
import { SimulationReferenceMap } from './simulation-reference-map';
import { SimulationRiskPanel } from './simulation-risk-panel';
import './simulation-geo.css';
import { useSimulationGeo } from '@/lib/use-simulation-geo';
import { epicenterForPlayedMilestones, historicTsunamiWarningStarted, screenGeoExposure } from '@/lib/geospatial-exposure';

export type SimulationSection = 'home' | 'plan' | 'events' | 'map' | 'more';
type Stage = 'waiting' | 'processing' | 'running' | 'completed' | 'failed';

const ui = {
  ja: { home:'ホーム',plan:'行動計画',events:'イベント',more:'その他',close:'演習を終了',
    warning:'演習画面 · 実際の警報ではありません', clock:'演習時刻',before:'地震発生まで', nextEvent:'次のイベント', next:'NEXT · 次の行動',avoid:'AVOID · 避ける',now:'NOW · 最優先',
    map:'地図', reference:'参考地図を開く',timeline:'時系列',eventDone:'処理済み',upcoming:'未発生',
    awaiting:'演習が始まる前です。周囲を確認し、落ち着いて準備してください。',waiting:'AI / Safety Core の判定を待っています',ending:'演習完了',
    unsupported:'歴史的参考情報のみ · 安全判断の対象外', earthquake:'地震発生', note:'国土地理院の日本全国参考地図です。海岸線は浸水や安全経路を示しません。',
    noRoute:'避難経路を案内できません', safety:'実際のGPS・通知・移動許可は使用しません',
    mapBack:'戻る', mapDetails:'地図の制限', reset:'終了して設定に戻る', ai:'AI / Safety Core',
    waitingNext:'次のイベントまで', consult:'史料', actions:'行動プラン', source:'模擬ソース', status:'ステータス',
    pending:'イベント発生を待っています', processing:'模擬イベントを処理中…', completed:'完了', mapData:'日本全国 · 海と陸を区別',
    risk:'歴史の津波警報・停電は時系列のみです。危険エリア、避難所、経路を推定表示しません。',
    error:'演習エラー', mapNotice:'安全な経路・避難所の認証なし', reason:'判断根拠',
    mapRiskTitle:'位置とリスク',mapRiskUnknown:'安全性：判定不能',mapRiskExpand:'リスク詳細とGPS',mapRiskCollapse:'地図を広く表示',tsunamiWarningSummary:'津波警報（歴史演習） · 避難安全性は未判定',
  },
  en: { home:'Home',plan:'Action plan',events:'Events',more:'More',close:'End drill',
    warning:'SIMULATION · Not a live alert',clock:'Simulation time',before:'Until the earthquake',nextEvent:'Next event',next:'NEXT · Next step',avoid:'AVOID · Avoid',now:'NOW · Immediate action',
    map:'Map',reference:'View reference map',timeline:'Timeline',eventDone:'Processed',upcoming:'Not yet',
    awaiting:'The drill has not reached the event. Stay ready and monitor surroundings.',waiting:'AI / Safety Core decision pending',ending:'Drill complete',
    unsupported:'Historical context only · no hazard assessment',earthquake:'Earthquake event',note:'Nationwide GSI reference map. Coastline is NOT an inundation or safe-route boundary.',
    noRoute:'Evacuation navigation unavailable',safety:'Actual GPS, alerts and movement authorization are disabled',
    mapBack:'Back',mapDetails:'Map limitations',reset:'End drill and return to setup',ai:'AI / Safety Core',
    waitingNext:'Until next event',consult:'Historic source',actions:'Action plan',source:'Simulated source',status:'Status',
    pending:'Waiting for a simulated event',processing:'Processing simulated event…',completed:'Completed',mapData:'All Japan · distinct land and sea',
    risk:'Tsunami and outage entries are historical context only. No inferred hazards, shelters or safe routes are displayed.',
    error:'Exercise error',mapNotice:'No verified shelter or safe route',reason:'Reason',
    mapRiskTitle:'Location & risk',mapRiskUnknown:'Safety: undetermined',mapRiskExpand:'Risk details & GPS',mapRiskCollapse:'Expand map',tsunamiWarningSummary:'Historic tsunami warning · safety not verified',
  },
  'zh-TW': { home:'首頁',plan:'行動計劃',events:'事件',more:'更多',close:'結束演習',
    warning:'模擬演習 · 並非真實警報',clock:'模擬時間',before:'距離地震發生',nextEvent:'下一事件',next:'NEXT · 接下來',avoid:'AVOID · 避免',now:'NOW · 立即行動',
    map:'地圖',reference:'查看參考地圖',timeline:'時間線',eventDone:'已處理',upcoming:'未發生',
    awaiting:'尚未到達模擬災難時間，請留意周圍環境並保持準備。',waiting:'等待 AI／Safety Core 判斷',ending:'演習完成',
    unsupported:'僅作歷史背景 · 不屬安全判斷',earthquake:'地震發生',note:'全日本國土地理院參考地圖，海岸線不是海嘯浸水或避難安全邊界。',
    noRoute:'暫時無法提供避難導航',safety:'不使用真實 GPS、通知或移動授權',
    mapBack:'返回',mapDetails:'地圖使用限制',reset:'結束演習並返回設定',ai:'AI／Safety Core',
    waitingNext:'距離下一事件',consult:'歷史來源',actions:'行動計劃',source:'模擬來源',status:'狀態',
    pending:'等待模擬事件發生',processing:'正在處理模擬事件…',completed:'已完成',mapData:'全日本 · 海陸分色',
    risk:'海嘯警報及停電只是歷史背景，不會推算危險區域、避難所或安全路線。',
    error:'演習出現錯誤',mapNotice:'沒有已核實避難所或安全路線',reason:'判斷原因',
    mapRiskTitle:'定位與災害風險',mapRiskUnknown:'安全性：無法判定',mapRiskExpand:'查看風險詳情及 GPS',mapRiskCollapse:'收起詳情、放大地圖',tsunamiWarningSummary:'歷史海嘯警報已發生 · 尚未確認避難安全',
  },
} as const;

const count = (seconds: number) => {
  const s = Math.max(0,Math.ceil(seconds));
  return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');
};

type Props = {
  config: SimulationLaunch; phase: Stage; tab: SimulationSection;
  setTab: Dispatch<SetStateAction<SimulationSection>>;
  time: number; speed: number; state: MockLiveResponse | null;
  done: number; processing: boolean; error: string; leave: () => void;
};

export function SimulationScreens({config,phase,tab,setTab,time,speed,state,done,processing,error,leave}:Props) {
  const language:Language = config.language;
  const t=ui[language];
  const [eventDetail,setEventDetail]=useState<number|null>(null);
  const [mapSheetExpanded,setMapSheetExpanded]=useState(false);
  const geo=useSimulationGeo();
  const epicenter=epicenterForPlayedMilestones(config.historicalCase,config.milestones,done);
  const warning=historicTsunamiWarningStarted(config.milestones,done);
  const assessment=screenGeoExposure({location:geo.location,epicenter,tsunamiWarningActive:warning,now:Date.now()});
  const current=config.milestones[Math.max(0,done-1)]??null;
  const upcoming=config.milestones[done]??null;
  const seconds=upcoming?Math.max(0,(Date.parse(upcoming.at_jst)-time)/1000):0;
  const plan=state?.snapshot.plans.find(p=>p.id===state.snapshot.situation.current_plan_id);
  const actions=state?.snapshot.plan_actions.filter(a=>a.plan_id===plan?.id && a.status==='ACTIVE')??[];
  const nowActions=actions.filter(a=>a.category==='NOW');
  const byCategory=(category:'NOW'|'NEXT'|'AVOID')=>actions.filter(a=>a.category===category);
  const ai=state?.ai_modes.includes('GEMINI_ADK')?'Gemini / ADK'
    :state?.ai_modes.some(m=>m.includes('FALLBACK'))?'Safety Core fallback':t.waiting;
  const doneEvent=done>0;
  const imminent=upcoming && seconds<=60;
  const timeText=jstInputFromEpoch(time).replace('T',' ');
  const firstEpoch=Date.parse(config.milestones[0]?.at_jst??'');
  const preludeEpoch=Date.parse(config.acceleratedStart+':00+09:00');
  const preludeProgress=config.timeMode==='ACCELERATED' && Number.isFinite(firstEpoch) && Number.isFinite(preludeEpoch)
    && firstEpoch>preludeEpoch ? Math.max(0,Math.min(100,(time-preludeEpoch)/(firstEpoch-preludeEpoch)*100)) : 100;
  const nav=[['home','⌂',t.home],['plan','▤',t.plan],['events','◷',t.events],['more','···',t.more]] as const;

  return <div className={`sim-v2-shell ${doneEvent?'sim-has-event':'sim-before-event'}`} data-testid="simulation-dashboard">
    <header className="sim-v2-header">
      <span className="sim-v2-wordmark">72<span>H</span></span>
      <span className="sim-v2-mode"><span className={doneEvent?'sim-v2-red-dot':'sim-v2-green-dot'}/>SIMULATION</span>
      <button type="button" className="sim-v2-settings" aria-label={t.more} onClick={()=>setTab('more')}>⚙</button>
    </header>
    <main className={`sim-v2-main sim-view-${tab}`}>
      {tab==='home'&&<section className="sim-v2-home" aria-label={t.home}>
        <div className="sim-v2-home-info">
          <div className="sim-v2-dateline">
            <span>{timeText.slice(0,10)} · JST</span>
            <span className={doneEvent?'sim-v2-rate sim-v2-rate-event':'sim-v2-rate'}>{speed}×</span>
          </div>
          <span className="sim-v2-clock-label">{timeText.slice(11)} JST</span>
          {!doneEvent ? <div className="sim-v2-hero-before">
            <p className="sim-v2-eyebrow">{t.before}</p>
            <strong className="sim-v2-huge-count" data-testid="simulation-countdown">{upcoming?count(seconds):t.pending}</strong>
            <div className="sim-v2-fine-progress" aria-hidden="true"><span style={{width:preludeProgress+'%'}}/></div>
            <strong className="sim-v2-scenario">{config.title}</strong>
            <p className="sim-v2-intro">{upcoming?.label[language]||t.pending}</p>
          </div> : <div className="sim-v2-hero-after">
            <div className="sim-v2-alert-lead"><span className="sim-v2-pulse">〰</span>
              <div><strong>{current?.kind==='EARTHQUAKE'?t.earthquake:current?.label[language]??t.earthquake}</strong>
                <small>{current?.at_jst.slice(11,16)??timeText.slice(11)} · {config.title}{current && !current.fed_to_safety_core ? ' · '+t.unsupported : ''}</small></div>
            </div>
            <div className="sim-v2-main-action"><span>{t.now}</span>
              <h1 data-testid="simulation-now">{nowActions.length?nowActions.map(a=>a.text).join(' · '):t.waiting}</h1>
            </div>
            <div className="sim-v2-two-actions">
              <div><b>{t.next}</b><p>{byCategory('NEXT').map(a=>a.text).join(' · ')||t.waiting}</p></div>
              <div><b>{t.avoid}</b><p>{byCategory('AVOID').map(a=>a.text).join(' · ')||t.waiting}</p></div>
            </div>
          </div>}
          <div className="sim-v2-home-footnote"><span className="sim-v2-network-symbol">✦</span>
            <span {...(!doneEvent ? {'data-testid':'simulation-now'} : {})}>{doneEvent?ai:t.awaiting}</span>
          </div>
        </div>
        <div className="sim-v2-map-teaser">
          <SimulationReferenceMap language={language} compact userLocation={assessment.user_location} epicenter={epicenter}/>
          <button type="button" className="sim-v2-expand-map" onClick={()=>setTab('map')}>{t.reference} <span aria-hidden="true">↗</span></button>
        </div>
        <div className="sim-v2-event-dock">
          <span className="sim-v2-dock-mark" aria-hidden="true">◷</span>
          <span className="sim-v2-dock-copy"><small>{upcoming?t.nextEvent:phase==='completed'?t.ending:t.processing}</small>
            <b>{upcoming?upcoming.at_jst.slice(11,16)+' · '+upcoming.label[language]:t.ending}</b></span>
          <strong>{upcoming?count(seconds):'✓'}</strong>
          <button type="button" aria-label={t.events} onClick={()=>setTab('events')}>›</button>
        </div>
      </section>}
      {tab==='plan'&&<section className="sim-v2-plan" data-testid="simulation-plan">
        <header className="sim-v2-page-title"><span>{t.actions}</span><small>{doneEvent?ai:t.pending}</small></header>
        {(['NOW','NEXT','AVOID'] as const).map((category,i)=><section key={category} className="sim-v2-plan-step">
          <span className={`sim-v2-plan-index sim-v2-step-${category.toLowerCase()}`}>{i+1}</span>
          <div><h2>{i===0?t.now:i===1?t.next:t.avoid}</h2>
            {byCategory(category).length?byCategory(category).map(a=><article key={a.id}><p>{a.text}</p><details><summary>{t.reason}</summary><p>{a.reason}</p></details></article>)
              :<p>{!doneEvent?t.pending:t.waiting}</p>}
          </div>
        </section>)}
        <details className="sim-v2-plan-source"><summary>{t.source} ({state?.snapshot.evidence.length??0})</summary>
          {state?.snapshot.evidence.map(e=><p key={e.id}>{e.source_name} · {e.summary}</p>)}
        </details>
        <p className="sim-v2-info-note">{t.warning} · {t.safety}</p>
      </section>}
      {tab==='events'&&<section className="sim-v2-timeline" data-testid="simulation-timeline">
        <div className="sim-v2-timeline-switch" role="group" aria-label={t.events}>
          <button type="button" className="selected" aria-pressed="true">{t.timeline}</button>
          <button type="button" aria-pressed="false" onClick={()=>setTab('map')}>{t.map}</button>
        </div>
        <ol className="sim-v2-timeline-list">
          {config.milestones.map((m,i)=><li key={m.at_jst+'-'+i} data-event-state={i<done?'processed':'pending'}
            className={i<done?'sim-v2-past':i===done?'sim-v2-next':'sim-v2-future'}>
            <span className="sim-v2-time-node" aria-hidden="true"/>
            <button type="button" onClick={()=>setEventDetail(value=>value===i?null:i)} aria-expanded={eventDetail===i}>
              <span className="sim-v2-timeline-time">{m.at_jst.slice(11,16)}</span>
              <span className="sim-v2-timeline-item"><strong>{m.label[language]}</strong>
                <small>{i<done?t.eventDone:i===done?t.nextEvent:t.upcoming} · {m.fed_to_safety_core?'Safety Core':t.unsupported}</small></span>
              <span className="sim-v2-timeline-chevron">›</span>
            </button>
            {eventDetail===i&&<div className="sim-v2-event-detail">
              <p>{m.fed_to_safety_core?t.ai:t.risk}</p>
              <a href={m.source_url} rel="noopener noreferrer" target="_blank">{t.consult} ↗</a>
            </div>}
          </li>)}
        </ol>
        <div className="sim-v2-timeline-map">
          <SimulationReferenceMap language={language} compact userLocation={assessment.user_location} epicenter={epicenter}/>
          <button type="button" onClick={()=>setTab('map')}>{t.reference} ↗</button>
        </div>
        <p className="sim-v2-timeline-caption">{t.note}</p>
      </section>}
      {tab==='map'&&<section className="sim-v2-fullmap" data-testid="simulation-map-screen">
        <header className="sim-v2-map-head">
          <button type="button" onClick={()=>setTab('events')} aria-label={t.mapBack}>‹</button>
          <div><strong>{t.map}</strong><small>{t.mapData}</small></div>
        </header>
        <SimulationReferenceMap language={language} userLocation={assessment.user_location} epicenter={epicenter}/>
        <div className="sim-v2-map-sheet sim-v2-map-sheet-risk"
          data-testid="simulation-map-sheet" data-sheet-state={mapSheetExpanded?'expanded':'collapsed'}>
          <button type="button" className="sim-v2-sheet-toggle" data-testid="simulation-risk-toggle"
            aria-controls="simulation-risk-details" aria-expanded={mapSheetExpanded}
            onClick={()=>setMapSheetExpanded(value=>!value)}>
            <span className="sim-v2-sheet-handle" aria-hidden="true"/>
            <span className="sim-v2-sheet-heading"><strong>{t.mapRiskTitle}</strong>
              <small>{mapSheetExpanded?t.mapRiskCollapse:t.mapRiskExpand}</small></span>
            <span className="sim-v2-sheet-status">{t.mapRiskUnknown}</span>
            <span className="sim-v2-sheet-arrow" aria-hidden="true">{mapSheetExpanded?'⌄':'⌃'}</span>
          </button>
          <p className={warning?'sim-v2-sheet-alert sim-v2-tsunami-active':'sim-v2-sheet-alert'} role="status">
            {warning?t.tsunamiWarningSummary:t.mapNotice}
          </p>
          <div id="simulation-risk-details" className="sim-v2-sheet-details" hidden={!mapSheetExpanded}>
            {mapSheetExpanded&&<>
              <SimulationRiskPanel language={language} assessment={assessment}
                gpsState={geo.state} gpsError={geo.error}
                requestLocation={geo.request} clearLocation={geo.clear}/>
              <p className="sim-v2-sheet-footnote">{t.note}</p>
              <p className="sim-v2-sheet-footnote">{t.risk}</p>
              <button type="button" className="sim-v2-back-timeline" onClick={()=>setTab('events')}>{t.timeline} →</button>
            </>}
          </div>
        </div>
      </section>}
      {tab==='more'&&<section className="sim-v2-more" data-testid="simulation-settings">
        <h1>{t.more}</h1>
        <div className="sim-v2-setting-row"><span>{t.status}</span><b>SIMULATION ONLY</b></div>
        <div className="sim-v2-setting-row"><span>{t.clock}</span><b data-testid="simulation-clock">{timeText}</b></div>
        <div className="sim-v2-setting-row"><span>{t.actions}</span><b>{config.title}</b></div>
        <div className="sim-v2-setting-row"><span>{t.ai}</span><b>{ai}</b></div>
        <p>{t.warning}</p><p>{t.safety}</p><p>{t.risk}</p>
        <button type="button" className="sim-v2-end" onClick={leave}>{t.reset}</button>
      </section>}
      {tab==='home'&&<span className="sim-v2-clock-test" data-testid="simulation-clock">{timeText}</span>}
      {processing&&<p role="status" className="sim-v2-processing">{t.processing}</p>}
      {error&&<p role="alert" className="sim-v2-error">{t.error}: {error}</p>}
      {phase==='completed'&&tab==='home'&&<span className="sim-v2-complete" role="status">{t.completed}</span>}
      <span className="sim-v2-safety-footer">{t.warning}</span>
    </main>
    <nav className="sim-v2-nav" aria-label={t.events}>
      {nav.map(([key,icon,label])=><button type="button" key={key} onClick={()=>setTab(key)}
        aria-current={tab===key||(tab==='map'&&key==='events')?'page':undefined}
        className={tab===key||(tab==='map'&&key==='events')?'selected':''}>
        <span aria-hidden="true">{icon}</span><small>{label}</small>
      </button>)}
    </nav>
  </div>;
}
