'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Language } from '@/lib/contracts';
import { advanceVirtualClock } from '@/lib/historical-playback';
import { seismicOriginsForMilestones, seismicWaveEndMs } from '@/lib/seismic-wavefront';
import { useSimulationSession, type SimulationLaunch } from '@/lib/simulation-session';
import { mockLiveRequest, type MockLiveResponse } from '@/lib/mock-live-envelope';
import { SimulationScreens, type SimulationSection } from './simulation-screens';
import './simulation-flat-ui.css';
import './simulation-map-ui.css';

type Phase = 'waiting' | 'processing' | 'running' | 'completed' | 'failed';
type Section = SimulationSection;
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
  const confirmText = { ja: '演習を終了して設定に戻りますか？', en: 'End simulation and return to settings?', 'zh-TW': '結束模擬並返回設定？' }[language];
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
  const [completedClock, setCompletedClock] = useState<number|null>(null);
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
          use_gemini: true,
          location_context: config.locationContext ?? null,
          conditions: config.conditions ?? {},
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
        if (!controller.signal.aborted) {
          // Event evaluation has finished, but physical waves do not stop at
          // the last rounded milestone or restart after AI latency.
          const anchor=clockAnchor.current;
          setCompletedClock(anchor ? anchor.simulated+Math.max(0,Date.now()-anchor.wall)
            : Date.parse(result.historical?.current_milestone?.at_jst??'') || Date.now());
          setPhase('completed');
        }
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

  useEffect(()=>{
    if(completedClock===null)return;
    const end=seismicWaveEndMs(seismicOriginsForMilestones(config.historicalCase,config.milestones));
    if(end===null||end<=completedClock)return;
    const wall=Date.now();
    const ticker=setInterval(()=>{
      const next=Math.min(end,completedClock+Math.max(0,Date.now()-wall));
      setTime(next);
      if(next>=end)clearInterval(ticker);
    },200);
    return()=>clearInterval(ticker);
  },[completedClock,config.historicalCase,config.milestones]);

  const leave = () => {
    if (!window.confirm(confirmText)) return;
    abortRef.current?.abort();
    endSimulation();
    router.replace('/disaster-test');
  };
  return <SimulationScreens config={config} phase={phase} tab={tab} setTab={setTab}
    time={time} speed={speed} state={state} done={done}
    processing={processing} error={error} leave={leave} />;
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
