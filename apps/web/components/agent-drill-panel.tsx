'use client';

import { useEffect, useRef, useState } from 'react';
import type { Language } from '@/lib/contracts';
import { snapshotSchema, type Snapshot } from '@/lib/contracts';
import type { DisasterTestInput } from '@/lib/disaster-test';
import { MockLiveRun } from './mock-live-run';

const copy = {
  ja: {
    title: 'AI実戦演習', notice: '模擬API → 実際のSafety Core → Gemini/ADK候補判定 → 計画・監査ログ',
    key: '演習アクセスキー', keyHint: '管理者が設定したキーです。この画面でのみ保持し、保存しません。',
    run: 'シナリオを実行', stop: '中止', executing: 'AI演習を実行中',
    unsupported: '現在の実戦エンジンは地震のみ対応。他の災種は画面プレビューだけです。',
    disabled: '演習APIが未設定か無効です（管理者設定が必要）。',
    accessDenied: 'アクセスキーが正しくありません。',
    step: '処理', done: '演習完了', error: '演習が完了しませんでした。',
    ai: 'AI候補選択', actual: 'Gemini/ADK 成功', fallback: 'AI失敗・安全規則にフォールバック', deterministic: '決定論的ルールのみ（AI実行なし）',
    actions: 'Safety Core が生成した行動', evidence: '模擬API証拠', log: '監査ログ（Trace）', empty: 'まだ行動計画がありません',
    synthetic: '演習中の情報はすべて架空であり、現実の避難指示ではありません。通信切断も端末ではなく演習内の状態です。',
    battery: '模擬電池残量はAIに伝達されますが、電力ポリシー自体は決定論的に計算されます。',
  },
  en: {
    title: 'Live AI exercise', notice: 'Simulated API → real Safety Core → Gemini/ADK intent choice → plan and trace',
    key: 'Exercise access key', keyHint: 'Administrator-issued key, kept in this page memory only.',
    run: 'Run AI exercise', stop: 'Stop', executing: 'Running AI exercise',
    unsupported: 'The end-to-end engine currently supports earthquakes only. Other hazards are visual previews.',
    disabled: 'Exercise API is disabled or not configured. Administrator setup is required.',
    accessDenied: 'Access key rejected.',
    step: 'Step', done: 'Exercise complete', error: 'Exercise did not complete.',
    ai: 'AI candidate selection', actual: 'Gemini/ADK successful', fallback: 'AI fallback to safe deterministic policy', deterministic: 'Deterministic policy only (no AI call)',
    actions: 'Safety Core plan actions', evidence: 'Simulated API evidence', log: 'Audit trace', empty: 'No action plan available',
    synthetic: 'All exercise data is fictional and cannot authorize real evacuation. Network outage is virtual, not on your phone.',
    battery: 'Simulated battery is sent to AI context; power policy is deterministically enforced.',
  },
  'zh-TW': {
    title: 'AI 實戰演習', notice: '模擬 API → 真正 Safety Core → Gemini／ADK 候選決策 → 計劃及 Trace',
    key: '演習存取密鑰', keyHint: '由管理員配置，只暫存在這個頁面的記憶體，不會儲存。',
    run: '開始 AI 實戰', stop: '停止', executing: 'AI 演習正在進行',
    unsupported: '目前完整實戰引擎只支援地震；其他災種暫時只有畫面示意，未接入 Safety Core。',
    disabled: '演習 API 未啟用或未配置；需要管理員設定。',
    accessDenied: '演習密鑰不正確。',
    step: '進度', done: '演習完成', error: '演習未能完成。',
    ai: 'AI 候選決策', actual: 'Gemini／ADK 已成功執行', fallback: 'AI 回退至保守安全規則', deterministic: '只有確定性規則（沒有執行 AI）',
    actions: 'Safety Core 生成的行動', evidence: '模擬 API 證據', log: '完整 Trace 紀錄', empty: '暫時沒有行動計劃',
    synthetic: '所有演習資訊均屬虛構，不構成真實避難指示。斷網只是模擬事件，不會關閉手機網絡。',
    battery: '模擬電量會傳入 AI 決策上下文；實際省電規則仍由確定性策略執行。',
  }, 'zh-CN': {
    title: 'AI 实战演习', notice: '仿真 API → 真正 Safety Core → Gemini／ADK 候选决策 → 计划及 Trace',
    key: '演习访问密钥', keyHint: '由管理员配置，只暂存在这个页面的内存，不会保存。',
    run: '开始 AI 实战', stop: '停止', executing: 'AI 演习正在进行',
    unsupported: '目前完整实战引擎只支持地震；其他灾种暂时只有画面示意，未接入 Safety Core。',
    disabled: '演习 API 未激活或未配置；需要管理员设置。',
    accessDenied: '演习密钥不正确。',
    step: '进度', done: '演习完成', error: '演习未能完成。',
    ai: 'AI 候选决策', actual: 'Gemini／ADK 已成功运行', fallback: 'AI 回退至保守安全规则', deterministic: '只有确定性规则（没有运行 AI）',
    actions: 'Safety Core 生成的行动', evidence: '仿真 API 证据', log: '完整 Trace 纪录', empty: '暂时没有行动计划',
    synthetic: '所有演习信息均属虚构，不构成真实避难指示。断网只是仿真事件，不会关闭手机网络。',
    battery: '仿真电量会传入 AI 决策上下文；实际省电规则仍由确定性策略运行。',
  },
} as const;

async function drillFetch(path: string, key: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/drill/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Drill-Key': key },
    body: body ? JSON.stringify(body) : undefined, signal, cache: 'no-store',
  });
  if (!response.ok) throw new Error(String(response.status));
  return snapshotSchema.parse(await response.json());
}

export function AgentDrillPanel({ input, language }: { input: DisasterTestInput; language: Language }) {
  const t = copy[language];
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [modes, setModes] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  // Never present a previous plan as if it were generated for edited conditions.
  // Abort an in-flight exercise and discard its UI state whenever inputs change.
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false); setSnapshot(null); setModes([]); setProgress(''); setError('');
  }, [input.kind, input.severity, input.battery, input.network, input.evidence, input.mobility, language]);

  const stop = () => { controller.current?.abort(); controller.current = null; setBusy(false); };
  const run = async () => {
    if (busy || input.kind !== 'EARTHQUAKE' || !key.trim()) return;
    const task = new AbortController();
    controller.current = task;
    setBusy(true); setError(''); setSnapshot(null); setModes([]);
    try {
      let state = await drillFetch('start', key.trim(), {
        kind: input.kind, severity: input.severity, battery: input.battery, network: input.network,
        evidence: input.evidence, mobility: input.mobility, language,
      }, task.signal);
      if (task.signal.aborted) return;
      setSnapshot(state);
      const seen: string[] = [];
      for (let i = 0; i < state.scenario_events.length; i++) {
        if (task.signal.aborted) return;
        setProgress(`${i + 1} / ${state.scenario_events.length} · ${state.scenario_events[i].label}`);
        state = await drillFetch(`${state.replay.id}/next`, key.trim(), {}, task.signal);
        if (task.signal.aborted) return;
        if (state.replay.planning_mode !== 'DETERMINISTIC_REPLAY_ONLY') seen.push(state.replay.planning_mode);
        setSnapshot(state);
        setModes([...seen]);
      }
      setProgress(t.done);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : '';
      if (code === '404') setError(t.disabled);
      else if (code === '403') setError(t.accessDenied);
      else if (!task.signal.aborted) setError(`${t.error} ${code === '503' ? '503' : ''}`);
    } finally {
      if (controller.current === task) { controller.current = null; setBusy(false); }
    }
  };
  const plan = snapshot?.plans.find(p => p.id === snapshot.situation.current_plan_id);
  const actions = snapshot?.plan_actions.filter(a => a.plan_id === plan?.id) ?? [];
  const hadAi = modes.includes('GEMINI_ADK');
  const hadFallback = modes.some(mode => mode.includes('FALLBACK'));
  const ai = hadAi && hadFallback ? `${t.actual} · ${t.fallback}`
    : hadAi ? t.actual : hadFallback ? t.fallback : t.deterministic;
  return <section className="lab-agent-drill" aria-labelledby="lab-agent-title">
    <h2 id="lab-agent-title">{t.title}</h2>
    <p>{t.notice}</p>
    <p className="lab-muted">{t.synthetic}</p>
    {input.kind !== 'EARTHQUAKE' && <p className="lab-drill-warning" role="status">{t.unsupported}</p>}
    <label className="lab-agent-key">{t.key}<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} /></label>
    <p className="lab-muted">{t.keyHint}</p>
    <MockLiveRun input={input} language={language} accessKey={key} />
    <details className="lab-legacy-replay"><summary>Replay / P1.5 — {t.run}</summary>
    <div className="lab-agent-actions">
      <button className="ui-btn ui-btn-secondary" type="button" disabled={busy || !key.trim() || input.kind !== 'EARTHQUAKE'} onClick={() => void run()}>{t.run}</button>
      {busy && <button type="button" onClick={stop}>{t.stop}</button>}
    </div>
    {busy && <p role="status">{t.executing} · {t.step} {progress}</p>}
    {!busy && snapshot?.replay.status === 'COMPLETED' && <p role="status">{t.done}</p>}
    {error && <p role="alert" className="lab-drill-warning">{error}</p>}
    {snapshot && <div className="lab-agent-results" aria-live="polite">
      <strong>{t.ai}: {ai}</strong>
      <p>{t.step}: {snapshot.replay.current_event_index}/{snapshot.scenario_events.length} · {snapshot.situation.network_state}</p>
      <p className="lab-muted">{t.battery}</p>
      <h3>{t.actions}</h3>
      {actions.length ? actions.map(action => <article key={action.id} className="lab-drill-action">
        <b>{action.category} · {action.safety_decision}</b>
        <p>{action.text}</p><small>{action.reason}</small>
      </article>) : <p>{t.empty}</p>}
      <details><summary>{t.evidence} ({snapshot.evidence.length})</summary>
        {snapshot.evidence.map(e => <p key={e.id}><strong>SIMULATED · {e.source_name}</strong> — {e.summary} · {e.freshness_status}</p>)}
      </details>
      <details><summary>{t.log} ({snapshot.trace.length})</summary>
        {snapshot.trace.map(e => <p key={e.id}><strong>{e.event_type}</strong> · {e.status}: {e.public_summary}</p>)}
      </details>
    </div>}
    </details>
  </section>;
}
