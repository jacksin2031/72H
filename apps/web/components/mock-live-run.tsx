'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSimulationSession } from '@/lib/simulation-session';
import { z } from 'zod';
import { type Language } from '@/lib/contracts';
import type { DisasterTestInput } from '@/lib/disaster-test';
import { ACCELERATION_OPTIONS, canPlayRealtime, jstInputFromEpoch, validAcceleratedPrelude, selectHistoricalRange, type Acceleration, type TimeMode } from '@/lib/historical-playback';
import { defaultSimulationConditions, type SimulationLocation, type SimulationConditions } from '@/lib/simulation-advice';
import { SimulationLocationControls } from './simulation-location-controls';

const milestoneSchema = z.object({
  at_jst: z.string(),
  kind: z.string(),
  label: z.object({ ja: z.string(), en: z.string(), 'zh-TW': z.string() }),
  source_url: z.string().url(),
  historic_observation: z.boolean(),
  fed_to_safety_core: z.boolean(),
});
const historicalCaseSchema = z.object({
  id: z.string(),
  year: z.number(),
  label: z.object({ ja: z.string(), en: z.string(), 'zh-TW': z.string() }),
  magnitude: z.string(),
  max_intensity: z.string(),
  area_id: z.string(),
  source_url: z.string().url(),
  milestones: z.array(milestoneSchema),
});
type HistoricalCase = z.infer<typeof historicalCaseSchema>;
const text = {
  ja: {
    title: 'Mock Live 実戦 — 正規 Live 処理経路', run: 'Mock Live で AI 実戦',
    wait: '模擬 API を処理しています', complete: '模擬 Live 演習が完了しました',
    stop: '停止', key: '上の管理者キーが必要です',
    status: '模擬状態', noAi: 'AI 候補選択なし', ai: 'Gemini / ADK 実行成功',
    fallback: 'AI は安全規則にフォールバック', actions: '実際の Safety Core の処理結果',
    evidence: '模擬ソース証拠', trace: 'Live Trace', blocked: '現実の移動許可は禁止',
    error: '模擬 Live 演習に失敗しました', missing: '管理者キーが必要です',
    unsupported: '現在の Mock Live は地震のみ対応します',
    history: '歴史的な大災害', custom: '自由設定（歴史データなし）', loading: '公式史料リストを読み込み中…',
    source: '気象庁・政府の史料', timeline: '史実に基づく時系列', historyNote: '歴史の時刻は当時の日本時間（JST）です。実際のAI処理は現在の模擬時刻で行います。',
    documented: '記録された出来事', assumption: '演習用仮定（実際の時刻ではありません）',
    unsupportedAdvisory: '停電は歴史的背景としてのみ表示します。Safety Core はその影響を評価していません。津波警報は模擬情報として Safety Core に入力されます。',
    processed: 'Safety Core へ入力（模擬）', contextual: '時系列のみ（歴史的背景）',
    timeMode:'再生時間', realtime:'史実の経過時間どおり（1倍速）', fast:'時間範囲を指定して即時実行',
    begin:'範囲の開始（JST）', end:'範囲の終了（JST）', selection:'対象のイベント',
    noEvents:'この時間帯に記録されたイベントはありません', invalid:'有効な歴史時間範囲を選択してください',
    longGap:'最長の待機時間が約28分を超えます。時間範囲の即時実行を使用してください。',
    waiting:'次の史実イベントまで', seconds:'秒', immediate:'即時実行では歴史時間の間隔を待たず、AI処理時間だけ必要です。',
    windowNote:'範囲外のイベントはサーバー側でもスキップします。',
    accelerate:'災害発生までは早送り → 発生時に自動で1倍速へ',
    simulatedStart:'シミュレーション開始時刻（JST）', speed:'災害前の時間倍率',
    liveClock:'仮想時計（JST）', prelude:'災害前の早送り', normalSpeed:'災害発生：実時間の1倍速',
    preludeInvalid:'災害の24時間前から直前までの時刻を選んでください。長すぎる待機は制限されます。',
    preludeNote:'災害発生まではAIを実行しません。発生と同時に1倍速に戻り、その後の史実イベントを順に処理します。',
  },
  en: {
    title: 'Mock Live exercise — real Live processing path', run: 'Run Mock Live + AI',
    wait: 'Processing simulated provider events', complete: 'Mock Live exercise complete',
    stop: 'Stop', key: 'Requires the administrator key above',
    status: 'Simulated state', noAi: 'No AI candidate selection', ai: 'Gemini / ADK executed',
    fallback: 'AI fell back to deterministic safety policy', actions: 'Actual Safety Core decisions',
    evidence: 'Synthetic provider evidence', trace: 'Live trace', blocked: 'Never authorizes actual movement',
    error: 'Mock Live exercise failed', missing: 'Administrator key required',
    unsupported: 'Full Mock Live currently supports earthquakes only',
    history: 'Historical disasters', custom: 'Custom simulation (not historical)', loading: 'Loading documented cases…',
    source: 'JMA / government records', timeline: 'Historically documented timeline', historyNote: 'Dates are historical Japan time. The actual AI exercise runs on a translated simulation clock.',
    documented: 'Documented historical milestone', assumption: 'Drill assumption (time not historical)',
    unsupportedAdvisory: 'The blackout is displayed as historical context only; the Safety Core has NOT assessed it. Tsunami warnings enter the Safety Core as simulated data.',
    processed: 'Sent to Safety Core (simulated)', contextual: 'Timeline only — historical background',
    timeMode:'Timeline playback', realtime:'Real historic elapsed time (1×)', fast:'Select time range, run immediately',
    begin:'Range start (JST)', end:'Range end (JST)', selection:'Included events',
    noEvents:'No documented events in this range', invalid:'Select a valid historical time window',
    longGap:'An actual gap exceeds ~28 minutes. Use instant time-range mode.',
    waiting:'Next historical event in', seconds:'sec', immediate:'Fast mode skips elapsed waiting; AI processing still takes time.',
    windowNote:'Events outside the range are skipped by the server, not just hidden.',
    accelerate:'Fast-forward before disaster → automatically switch to 1× at first event',
    simulatedStart:'Simulation start (JST)', speed:'Pre-event clock speed',
    liveClock:'Simulation clock (JST)', prelude:'Fast-forward before event', normalSpeed:'Disaster occurred: real-time 1×',
    preludeInvalid:'Choose within the 24h before the first event; overly long real waits are limited.',
    preludeNote:'No AI event runs before disaster time. At the first event the clock becomes 1× and subsequent events follow historical timing.',
  },
  'zh-TW': {
    title: 'Mock Live 實戰 — 真正 Live 處理流程', run: '開始 Mock Live + AI 實戰',
    wait: '正處理模擬 API 事件', complete: 'Mock Live 演習完成',
    stop: '停止', key: '使用上面的管理員存取密鑰',
    status: '模擬系統狀態', noAi: '沒有 AI 候選決策', ai: 'Gemini／ADK 真正成功執行',
    fallback: 'AI 回退至確定性安全規則', actions: 'Safety Core 真正生成的行動',
    evidence: '模擬 API 證據', trace: 'Live 決策 Trace', blocked: '絕不授權真實移動',
    error: 'Mock Live 演習失敗', missing: '需要管理員存取密鑰',
    unsupported: '目前完整 Mock Live 只支援地震',
    history: '歷史重大災難', custom: '自訂模擬（非歷史事件）', loading: '正在載入有來源的歷史案例…',
    source: '日本氣象廳／政府史料', timeline: '真實歷史事件時間線', historyNote: '時間均為當時日本時間。AI 實戰會把歷史事件轉換至現在的模擬時鐘，並非正式即時速報。',
    documented: '已核實的歷史事件', assumption: '演習假設（並非真實歷史時間）',
    unsupportedAdvisory: '只有停電作歷史背景展示，Safety Core 並未評估其影響；海嘯警報會以模擬資料輸入 Safety Core。',
    processed: '輸入 Safety Core（模擬）', contextual: '只顯示時間線（歷史背景）',
    timeMode:'時間播放模式', realtime:'按歷史原速（1× 真實時間間隔）', fast:'指定時間範圍，立即測試',
    begin:'範圍開始（日本時間）', end:'範圍結束（日本時間）', selection:'範圍內事件',
    noEvents:'此時段沒有收錄歷史事件', invalid:'請選擇有效的歷史時間範圍',
    longGap:'部分事件相距超過約 28 分鐘，請改用時間範圍快速測試。',
    waiting:'距離下一個歷史事件', seconds:'秒', immediate:'快速模式不等待歷史事件的時間間隔，但仍需要 AI 推理時間。',
    windowNote:'範圍外的事件會由後端排除，不只是在畫面上隱藏。',
    accelerate:'災難前高倍速 → 發生時自動回復正常 1×',
    simulatedStart:'模擬開始時間（日本時間）', speed:'災難發生前的時鐘倍率',
    liveClock:'模擬時鐘（日本時間）', prelude:'災前快速推進中', normalSpeed:'災難發生，已切換至正常 1×',
    preludeInvalid:'開始時間須在首次災難前 24 小時內，亦不能設定過長的實際等待。',
    preludeNote:'未到災難發生時間不會呼叫 AI 處理事件；到達首個災難事件即切換 1×，其後依歷史間隔觸發。',
  },
} as const;

export function MockLiveRun({ input, language, accessKey }: { input: DisasterTestInput; language: Language; accessKey: string }) {
  const t = text[language];
  const router = useRouter();
  const { startSimulation } = useSimulationSession();
  const [historicalCase, setHistoricalCase] = useState('tohoku-2011');
  const [timeMode, setTimeMode] = useState<TimeMode>('ACCELERATED');
  const [acceleratedStart, setAcceleratedStart] = useState('');
  const [acceleration, setAcceleration] = useState<Acceleration>(600);
  const [startJst, setStartJst] = useState('');
  const [endJst, setEndJst] = useState('');
  const [catalog, setCatalog] = useState<HistoricalCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationContext,setLocationContext]=useState<SimulationLocation|null>(null);
  const [conditions,setConditions]=useState<SimulationConditions>(defaultSimulationConditions);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/mock-live/cases', { cache: 'no-store', signal: abort.signal })
      .then(res => { if (!res.ok) throw Error(String(res.status)); return res.json(); })
      .then(data => { if (!abort.signal.aborted) setCatalog(z.array(historicalCaseSchema).parse(data)); })
      .catch(() => { if (!abort.signal.aborted) setCatalog([]); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const chosen = catalog.find(c => c.id === historicalCase);
    const first = chosen?.milestones[0]?.at_jst;
    setStartJst(first?.slice(0,16) ?? '');
    setEndJst(chosen?.milestones.at(-1)?.at_jst.slice(0,16) ?? '');
    setAcceleratedStart(first ? jstInputFromEpoch(Date.parse(first) - 60*60*1000) : '');
  }, [catalog, historicalCase]);
  const chosen = catalog.find(c => c.id === historicalCase);
  const selectedEvents = chosen ? timeMode === 'FAST_RANGE'
    ? selectHistoricalRange(chosen.milestones, startJst, endJst) : chosen.milestones : [];
  const rangeValid = !chosen || (selectedEvents.length > 0 && startJst <= endJst &&
    startJst >= chosen.milestones[0].at_jst.slice(0,16) && endJst <= chosen.milestones.at(-1)!.at_jst.slice(0,16));
  const realtimeValid = timeMode === 'FAST_RANGE' || canPlayRealtime(selectedEvents);
  const preludeValid = timeMode !== 'ACCELERATED' || !chosen ||
    validAcceleratedPrelude(acceleratedStart, chosen.milestones[0].at_jst, acceleration);
  const enabled = Boolean(accessKey.trim()) && input.kind === 'EARTHQUAKE' &&
    (!historicalCase || Boolean(chosen)) && rangeValid && realtimeValid && preludeValid;
  const start = () => {
    if (!enabled) return;
    startSimulation({
      input: { ...input }, language, accessKey: accessKey.trim(),
      historicalCase: historicalCase || null,
      title: chosen?.label[language] ?? t.custom,
      milestones: selectedEvents.map(m => ({ ...m })),
      timeMode, acceleratedStart, acceleration, startJst, endJst,
      locationContext, conditions,
    });
    router.push('/simulation');
  };
  return <section className="lab-mock-live" data-testid="mock-live-panel">
    <h3>{t.title}</h3>
    <p className="lab-muted"><strong>SIMULATION ONLY</strong> — {t.blocked}</p>
    <SimulationLocationControls language={language} location={locationContext} conditions={conditions}
      onLocation={setLocationContext} onConditions={setConditions}/>
    {input.kind !== 'EARTHQUAKE' && <p role="status">{t.unsupported}</p>}
    <label className="lab-history-select">{t.history}
      <select data-testid="historical-case" value={historicalCase} onChange={e => setHistoricalCase(e.target.value)}>
        <option value="">{t.custom}</option>
        {catalog.map(c => <option key={c.id} value={c.id}>{c.label[language]} · M{c.magnitude}</option>)}
      </select>
    </label>
    {loading && <p role="status" className="lab-muted">{t.loading}</p>}
    {chosen && <div className="lab-history-details" data-testid="historical-timeline">
      <strong>{chosen.label[language]} · M{chosen.magnitude} · {t.history}</strong>
      <details><summary>{t.timeline} ({chosen.milestones.length})</summary>
        <ol>{chosen.milestones.map(m => <li key={m.at_jst}>
          <small>{m.at_jst.slice(0,16).replace('T',' ')} JST · {m.fed_to_safety_core ? t.processed : t.contextual}</small>
          <strong>{m.label[language]}</strong>
          {!m.historic_observation && <small>{t.assumption}</small>}
          <a href={m.source_url} target="_blank" rel="noopener noreferrer">{t.source} ↗</a>
        </li>)}</ol>
      </details>
      {chosen.milestones.some(m => !m.fed_to_safety_core) && <p className="lab-history-caution">{t.unsupportedAdvisory}</p>}
    </div>}
    {chosen && <fieldset className="lab-history-timing">
      <legend>{t.timeMode}</legend>
      <label><input type="radio" name="history-time" value="ACCELERATED" checked={timeMode === 'ACCELERATED'} onChange={() => setTimeMode('ACCELERATED')}/>{t.accelerate}</label>
      <label><input type="radio" name="history-time" value="FAST_RANGE" checked={timeMode === 'FAST_RANGE'} onChange={() => setTimeMode('FAST_RANGE')}/>{t.fast}</label>
      <label><input type="radio" name="history-time" value="REALTIME" checked={timeMode === 'REALTIME'} onChange={() => setTimeMode('REALTIME')}/>{t.realtime}</label>
      {timeMode === 'ACCELERATED' && <div className="lab-history-window">
        <label>{t.simulatedStart}<input type="datetime-local" data-testid="accelerated-start" value={acceleratedStart}
          min={jstInputFromEpoch(Date.parse(chosen.milestones[0].at_jst) - 24*60*60*1000)}
          max={jstInputFromEpoch(Date.parse(chosen.milestones[0].at_jst) - 60*1000)}
          onChange={e => setAcceleratedStart(e.target.value)}/></label>
        <label>{t.speed}<select data-testid="acceleration" value={acceleration} onChange={e => setAcceleration(Number(e.target.value) as Acceleration)}>
          {ACCELERATION_OPTIONS.map(x => <option key={x} value={x}>{x}×</option>)}</select></label>
      </div>}
      {timeMode === 'FAST_RANGE' && <div className="lab-history-window">
        <label>{t.begin}<input type="datetime-local" data-testid="historical-start" value={startJst}
          min={chosen.milestones[0].at_jst.slice(0,16)} max={chosen.milestones.at(-1)!.at_jst.slice(0,16)}
          onChange={e => setStartJst(e.target.value)}/></label>
        <label>{t.end}<input type="datetime-local" data-testid="historical-end" value={endJst}
          min={chosen.milestones[0].at_jst.slice(0,16)} max={chosen.milestones.at(-1)!.at_jst.slice(0,16)}
          onChange={e => setEndJst(e.target.value)}/></label>
      </div>}
      <p className="lab-muted">{timeMode === 'FAST_RANGE' ? t.immediate : timeMode === 'ACCELERATED' ? t.preludeNote : t.historyNote}</p>
      <p data-testid="history-count">{t.selection}: {selectedEvents.length}/{chosen.milestones.length}</p>
      {!rangeValid && <p className="lab-drill-warning" role="alert">{t.invalid}</p>}
      {!realtimeValid && <p className="lab-drill-warning" role="alert">{t.longGap}</p>}
      {!preludeValid && <p className="lab-drill-warning" role="alert">{t.preludeInvalid}</p>}
    </fieldset>}
    <button className="ui-btn ui-btn-primary" data-testid="launch-full-simulation" type="button" disabled={!enabled} onClick={start}>
      {language === 'ja' ? 'シミュレーション開始 → ホーム画面' : language === 'en' ? 'Start full simulation → Home' : '開始整體模擬 → 進入主畫面'}
    </button>
    {!accessKey.trim() && <p className="lab-muted">{t.missing}</p>}
  </section>;
}
