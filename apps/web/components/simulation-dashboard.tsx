'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Language } from '@/lib/contracts';
import { advanceVirtualClock, jstInputFromEpoch } from '@/lib/historical-playback';
import { useSimulationSession, type SimulationLaunch } from '@/lib/simulation-session';
import { mockLiveRequest, type MockLiveResponse } from '@/lib/mock-live-envelope';
import './simulation-dashboard.css';

type Phase = 'waiting' | 'processing' | 'running' | 'completed' | 'failed';
type Section = 'home' | 'plan' | 'events' | 'more';
const words = {
  ja: {
    simulation: '災害シミュレーション中', note: '架空の演習です。実際の警報・避難指示ではありません',
    home: 'ホーム', plan: '行動計画', events: 'イベント', more: '設定',
    prelude: '災害発生まで', untilNext: '次のイベントまで', clock: 'シミュレーション時刻',
    fast: '高速再生', speed: '時間倍率', started: '災害イベントを処理中', pending: '災害発生前です。安全を確保して情報を確認してください。',
    waitingAI: 'Safety Core / AI が処理しています…', now: 'NOW', next: 'NEXT', avoid: 'AVOID',
    noAction: '判断中：未確認の経路・避難先へ移動しないでください。',
    complete: '演習完了', failed: '演習を完了できませんでした',
    stop: '演習を終了', confirm: '演習を終了して設定に戻りますか？',
    missing: '演習のメモリーがありません。設定画面からもう一度開始してください。',
    restart: '演習設定へ', noNotification: '実際の通知・通話・地図案内は無効',
    passed: '処理済み', upcoming: '未発生', historical: '歴史的事実の参考表示',
    unsupported: '津波や停電は歴史の参考情報のみ。専用の安全判断は未実装です。',
    success: 'Gemini / ADK 実行成功', fallback: '安全ルールで処理', noAi: 'AI 判定待ち',
    conditions: '模擬条件', evidence: '模擬データ', source: '情報源', safety: '移動許可なし',
    paused: '実際の端末の日時・通信・バッテリーは変更しません',
  },
  en: {
    simulation: 'Disaster simulation running', note: 'Practice only — not a real emergency alert or evacuation order',
    home: 'Home', plan: 'Plan', events: 'Timeline', more: 'Settings',
    prelude: 'Until disaster', untilNext: 'Next event in', clock: 'Simulation clock',
    fast: 'Accelerated', speed: 'Clock speed', started: 'Processing disaster event', pending: 'Before the event: stay prepared and monitor information.',
    waitingAI: 'Safety Core / AI is processing…', now: 'NOW', next: 'NEXT', avoid: 'AVOID',
    noAction: 'Pending assessment: do not trust unverified routes or destinations.',
    complete: 'Exercise complete', failed: 'Exercise could not finish',
    stop: 'End simulation', confirm: 'End this exercise and return to scenario setup?',
    missing: 'Simulation memory expired. Start a new exercise from Settings.',
    restart: 'Back to simulation setup', noNotification: 'No real alerts, calls or maps',
    passed: 'Processed', upcoming: 'Upcoming', historical: 'Recorded historical background',
    unsupported: 'Tsunami / outage milestones are historical context only; their dedicated Safety Core is not implemented.',
    success: 'Gemini / ADK completed', fallback: 'Safe rule fallback', noAi: 'AI not called yet',
    conditions: 'Synthetic conditions', evidence: 'Simulated evidence', source: 'Provider', safety: 'Real travel blocked',
    paused: 'Device time, network and battery stay unchanged',
  },
  'zh-TW': {
    simulation: '災難實戰模擬中', note: '演習專用，並非真實警報或避難指示',
    home: '首頁', plan: '行動計劃', events: '事件', more: '設定',
    prelude: '距離災難發生', untilNext: '距離下一事件', clock: '模擬時鐘',
    fast: '加速前進', speed: '時鐘倍率', started: '正在處理災難事件', pending: '災難尚未發生，先做好準備及留意資訊。',
    waitingAI: 'Safety Core／AI 正在分析…', now: 'NOW', next: 'NEXT', avoid: 'AVOID',
    noAction: '正在判斷，切勿將未核實路線或避難場所當作安全。',
    complete: '演習完成', failed: '演習未能完成',
    stop: '結束模擬', confirm: '結束演習並返回情境設定？',
    missing: '模擬工作階段已消失，請返回設定重新開始。',
    restart: '返回模擬設定', noNotification: '不會發送真實警報、撥號或導航',
    passed: '已處理', upcoming: '未發生', historical: '歷史事件背景',
    unsupported: '海嘯／停電只作歷史背景；其專用 Safety Core 尚未實作。',
    success: 'Gemini／ADK 已成功決策', fallback: '安全規則回退', noAi: 'AI 尚未執行',
    conditions: '模擬條件', evidence: '模擬來源資料', source: '資料來源', safety: '禁止真實移動授權',
    paused: '手機真實時間、網絡及電量不會改變',
  },
} as const;

const hms = (seconds: number) => {
  const value = Math.max(0, Math.ceil(seconds));
  return [Math.floor(value / 3600), Math.floor(value % 3600 / 60), value % 60]
    .map(x => String(x).padStart(2,'0')).join(':');
};

function validateConfig(config: SimulationLaunch) {
  if (!config.accessKey || config.accessKey.length < 32 || config.input.kind !== 'EARTHQUAKE') {
    throw new Error('Invalid exercise configuration');
  }
  if (config.historicalCase && !config.milestones.length) throw new Error('No historical events');
  if (config.milestones.some((item, i) => i > 0 && Date.parse(item.at_jst) < Date.parse(config.milestones[i-1].at_jst))) {
    throw new Error('Historical milestones out of order');
  }
}

function Playback({ config }: { config: SimulationLaunch }) {
  const router = useRouter();
  const { endSimulation } = useSimulationSession();
  const language: Language = config.language;
  const t = words[language];
  const [phase, setPhase] = useState<Phase>('waiting');
  const [tab, setTab] = useState<Section>('home');
  const [time, setTime] = useState<number>(() => config.milestones.length
    ? config.timeMode === 'ACCELERATED' ? Date.parse(config.acceleratedStart+':00+09:00')
      : Date.parse(config.milestones[0].at_jst) : Date.now());
  const [speed, setSpeed] = useState<number>(() => config.timeMode === 'ACCELERATED' ? config.acceleration : 1);
  const [state, setState] = useState<MockLiveResponse | null>(null);
  const [done, setDone] = useState(0);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const clockAnchor = useRef<{ wall: number; simulated: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    let ticker: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        validateConfig(config);
        const first = config.milestones[0]?.at_jst;
        // Clock prelude is client-side only. No AI, Live Store or API calls
        // can happen until the virtual earthquake time is reached.
        if (first && config.timeMode === 'ACCELERATED') {
          setPhase('waiting'); setSpeed(config.acceleration);
          await advanceVirtualClock(config.acceleratedStart+':00+09:00',
            first, config.acceleration, controller.signal, (at) => setTime(at));
        }
        if (controller.signal.aborted) return;
        if (first && config.timeMode !== 'FAST_RANGE') {
          const start = Date.parse(first);
          setTime(start); setSpeed(1);
          clockAnchor.current = { wall: Date.now(), simulated: start };
          ticker = setInterval(() => {
            const anchor = clockAnchor.current;
            if (anchor) setTime(anchor.simulated + Math.max(0, Date.now()-anchor.wall));
          }, 200);
        } else {
          setSpeed(1);
          setTime(first ? Date.parse(first) : Date.now());
        }
        setPhase('running'); setProcessing(true);
        let result = await mockLiveRequest('start', config.accessKey, {
          ...config.input, language,
          historical_case: config.historicalCase,
          historical_start_jst: config.historicalCase && config.timeMode === 'FAST_RANGE' ? config.startJst+':00+09:00' : null,
          historical_end_jst: config.historicalCase && config.timeMode === 'FAST_RANGE' ? config.endJst+':00+09:00' : null,
        }, controller.signal);
        if (controller.signal.aborted) return;
        setState(result); setProcessing(false);
        for (let i=0; i<result.total_steps; i++) {
          const milestone = result.historical?.milestones[i];
          if (milestone && config.timeMode !== 'FAST_RANGE' && clockAnchor.current) {
            const target=Date.parse(milestone.at_jst);
            // The background page may be throttled; elapsed wall time is the
            // minimum safe clock. Never dispatch an event before its JST time.
            const anchor=clockAnchor.current;
            const remaining=target - (anchor.simulated + (Date.now()-anchor.wall));
            if (remaining>0) {
              await advanceVirtualClock(new Date(Date.now()).toISOString(),
                new Date(Date.now()+remaining).toISOString(),1,controller.signal,() => {});
            }
          }
          if (controller.signal.aborted) return;
          setProcessing(true);
          result = await mockLiveRequest(result.snapshot.session_id+'/next', config.accessKey, {}, controller.signal);
          if (controller.signal.aborted) return;
          setState(result); setDone(i+1); setProcessing(false);
          if (milestone && config.timeMode === 'FAST_RANGE') setTime(Date.parse(milestone.at_jst));
        }
        if (!controller.signal.aborted) setPhase('completed');
      } catch (ex) {
        if (!controller.signal.aborted) {
          setError(ex instanceof Error ? ex.message : 'Unknown error');
          setPhase('failed');
        }
      } finally {
        if (ticker) clearInterval(ticker);
        clockAnchor.current = null;
        if (!controller.signal.aborted) setProcessing(false);
      }
    };
    void run();
    return () => { controller.abort(); if (ticker) clearInterval(ticker); };
  // One immutable launch configuration per mounted exercise.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = () => {
    if (!window.confirm(t.confirm)) return;
    abortRef.current?.abort();
    endSimulation();
    router.replace('/disaster-test');
  };
  const upcoming = config.milestones[done] ?? null;
  const seconds = upcoming ? Math.max(0, (Date.parse(upcoming.at_jst)-time)/1000) : 0;
  const plan = state?.snapshot.plans.find(item => item.id === state.snapshot.situation.current_plan_id);
  const actions = state?.snapshot.plan_actions.filter(item => item.plan_id === plan?.id && item.status === 'ACTIVE') ?? [];
  const nowActions = actions.filter(item => item.category === 'NOW');
  const otherActions = (category: 'NEXT' | 'AVOID') => actions.filter(item => item.category === category);
  const ai = state?.ai_modes.includes('GEMINI_ADK') ? t.success
    : state?.ai_modes.some(x => x.includes('FALLBACK')) ? t.fallback : t.noAi;
  const allDone = phase === 'completed';

  return <div className="live-shell role-mobile has-live-session sim-shell" data-testid="simulation-dashboard">
    <header className="live-topbar sim-topbar">
      <span className="live-brand">72<span>H</span></span>
      <span className="sim-live-flag">● SIMULATION</span>
      <button type="button" onClick={leave} className="sim-stop">{t.stop}</button>
    </header>
    <main className="live-main sim-main">
      <section role="status" className="sim-safety-banner">
        <strong>{t.simulation}</strong><small>{t.note}</small>
      </section>
      <section className="sim-clock-panel" aria-label={t.clock}>
        <div className="sim-clock-top"><span>{t.clock} · JST</span><strong>{speed}×</strong></div>
        <strong className="sim-big-clock" data-testid="simulation-clock">{jstInputFromEpoch(time).replace('T',' ')}</strong>
        <div className="sim-next-event" data-testid="simulation-countdown">
          {upcoming ? <><small>{done===0?t.prelude:t.untilNext}</small>
            <strong className="sim-countdown-value">{hms(seconds)}</strong></>
            : <strong>{allDone?t.complete: t.started}</strong>}
        </div>
        {upcoming && <small className="sim-upcoming">{upcoming.at_jst.slice(11,16)} · {upcoming.label[language]} · {t.historical}</small>}
        <div className="sim-progress" role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(config.milestones.length,state?.total_steps??1)}
          aria-valuenow={done} aria-label={t.events}><span style={{width: Math.min(100,done/Math.max(config.milestones.length,state?.total_steps??1)*100)+'%'}} /></div>
      </section>
      {(processing || error) && <p className={error?'lab-drill-warning':'sim-processing'} role={error?'alert':'status'}>{error||t.waitingAI}</p>}
      {phase==='completed' && <p className="sim-complete" role="status">✓ {t.complete}</p>}
      {tab==='home' && <section className="sim-home adaptive-home">
        <header className="situation-header"><div><h1>{done===0?t.home:config.title}</h1>
          <p>{done===0?t.pending:ai}</p></div></header>
        <section className="now-card" aria-label={t.now}><small>NOW · MOCK</small>
          <h2 data-testid="simulation-now">{nowActions.length ? nowActions.map(a => a.text).join(' · ') : done===0?t.pending:t.noAction}</h2>
        </section>
        {done>0 && <p className="sim-synthetic-source">SIMULATED · {state?.snapshot.source.source_name} · {state?.snapshot.source.status}</p>}
        <div className="sim-home-cards">
          <article><strong>{t.next}</strong><p>{otherActions('NEXT').map(a=>a.text).join(' · ')||t.noAction}</p></article>
          <article><strong>{t.avoid}</strong><p>{otherActions('AVOID').map(a=>a.text).join(' · ')||t.noAction}</p></article>
        </div>
        <p className="sim-no-actions">{t.noNotification} · {t.safety}</p>
      </section>}
      {tab==='plan' && <section className="sim-section" data-testid="simulation-plan">
        <h1>{t.plan}</h1><p>{ai} · {t.safety}</p>
        {(['NOW','NEXT','AVOID'] as const).map(category => <section key={category} className="sim-plan-group">
          <h2>{category}</h2>{actions.filter(a => a.category === category).length
            ? actions.filter(a=>a.category===category).map(a=><article key={a.id}><strong>{a.text}</strong><p>{a.reason}</p><small>{a.safety_decision}</small></article>)
            : <p>{t.noAction}</p>}
        </section>)}
        <details><summary>{t.evidence} ({state?.snapshot.evidence.length??0})</summary>
          {state?.snapshot.evidence.map(e=><p key={e.id}>MOCK · {e.source_name}: {e.summary}</p>)}
        </details>
      </section>}
      {tab==='events' && <section className="sim-section" data-testid="simulation-timeline">
        <h1>{t.events}</h1>
        <ol>{config.milestones.map((item,i)=><li key={item.at_jst+'-'+i} data-event-state={i<done?'processed':'pending'}>
          <strong>{item.at_jst.slice(0,16).replace('T',' ')} JST</strong>
          <p>{i<done?'✓ '+t.passed:t.upcoming} · {item.label[language]}</p>
          <small>{item.fed_to_safety_core ? 'EARTHQUAKE · Safety Core' : t.unsupported}</small>
        </li>)}</ol>
        <details><summary>AI Trace ({state?.snapshot.trace.length??0})</summary>
          {state?.snapshot.trace.map(e=><p key={e.id}><b>{e.event_type}</b> · {e.public_summary}</p>)}
        </details>
      </section>}
      {tab==='more' && <section className="sim-section" data-testid="simulation-settings">
        <h1>{t.conditions}</h1>
        <p>{config.title} · L{config.input.severity} · {config.input.battery??'—'}% · {config.input.network}</p>
        <p>{t.paused}</p><p>{t.noNotification}</p><p>{t.safety}</p>
        <button type="button" className="sim-stop sim-end-main" onClick={leave}>{t.stop}</button>
      </section>}
      <nav className="mobile-primary-nav sim-nav" aria-label={language==='ja'?'演習メニュー':language==='en'?'Simulation navigation':'模擬主選單'}>
        {(['home','plan','events','more'] as const).map((item,i)=><button type="button" key={item}
          aria-current={tab===item?'page':undefined} className={tab===item?'selected':''} onClick={()=>setTab(item)}>
          <span aria-hidden="true">{['⌂','▤','◷','···'][i]}</span><small>{t[item]}</small>
        </button>)}
      </nav>
    </main>
  </div>;
}

export function SimulationDashboard() {
  const { launch } = useSimulationSession();
  const router = useRouter();
  if (!launch) return <main className="sim-unavailable" data-testid="simulation-expired">
    <h1>72H · SIMULATION</h1><p>演習工作階段已結束。重新進入測試設定即可開始。</p>
    <button type="button" onClick={()=>router.replace('/disaster-test')}>返回災難測試 / Back</button>
  </main>;
  return <Playback config={launch} />;
}
