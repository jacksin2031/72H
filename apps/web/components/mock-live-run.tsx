'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { liveSnapshotSchema, type Language } from '@/lib/contracts';
import type { DisasterTestInput } from '@/lib/disaster-test';

const envelope = z.object({
  mode: z.literal('MOCK_LIVE'),
  current_step: z.number().int().nonnegative(),
  total_steps: z.number().int().positive().max(3),
  ai_modes: z.array(z.string()),
  battery: z.number().nullable(),
  snapshot: liveSnapshotSchema,
});
type MockResponse = z.infer<typeof envelope>;

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
  },
} as const;

async function call(path:string, key:string, input?:unknown, signal?:AbortSignal):Promise<MockResponse>{
  const res=await fetch('/api/mock-live/'+path,{
    method:input===undefined?'GET':'POST',
    headers:{'Content-Type':'application/json','X-Drill-Key':key},
    body:input===undefined?undefined:JSON.stringify(input), cache:'no-store', signal,
  });
  if(!res.ok)throw new Error(String(res.status));
  return envelope.parse(await res.json());
}

export function MockLiveRun({input,language,accessKey}:{input:DisasterTestInput;language:Language;accessKey:string}){
  const t=text[language];
  const [state,setState]=useState<MockResponse|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [complete,setComplete]=useState(false);
  const controller=useRef<AbortController|null>(null);

  useEffect(()=>{
    controller.current?.abort(); controller.current=null;
    setState(null);setBusy(false);setError('');setComplete(false);
  },[input.kind,input.severity,input.battery,input.network,input.evidence,input.mobility,language]);

  const stop=()=>{controller.current?.abort();controller.current=null;setBusy(false)};
  const run=async()=>{
    if(busy||input.kind!=='EARTHQUAKE'||!accessKey.trim())return;
    const task=new AbortController();controller.current=task;
    setState(null);setError('');setComplete(false);setBusy(true);
    try{
      let result=await call('start',accessKey.trim(),{
        kind:input.kind,severity:input.severity,battery:input.battery,network:input.network,
        evidence:input.evidence,mobility:input.mobility,language,
      },task.signal);
      if(task.signal.aborted)return;
      setState(result);
      for(let i=0;i<result.total_steps;i++){
        result=await call(result.snapshot.session_id+'/next',accessKey.trim(),{},task.signal);
        if(task.signal.aborted)return;
        setState(result);
      }
      setComplete(true);
    }catch(ex){
      if(!task.signal.aborted)setError(t.error+' ('+(ex instanceof Error?ex.message:'unknown')+')');
    }finally{
      if(controller.current===task){controller.current=null;setBusy(false)}
    }
  };
  const snapshot=state?.snapshot;
  const plan=snapshot?.plans.find(p=>p.id===snapshot.situation.current_plan_id);
  const actions=snapshot?.plan_actions.filter(a=>a.plan_id===plan?.id)||[];
  const ai=state?.ai_modes.includes('GEMINI_ADK') ? t.ai :
    state?.ai_modes.some(s=>s.includes('FALLBACK')) ? t.fallback :t.noAi;
  return <div className="lab-mock-live" data-testid="mock-live-panel">
    <h3>{t.title}</h3>
    <p className="lab-muted"><strong>MOCK_LIVE · SIMULATION ONLY</strong> — {t.blocked}</p>
    {input.kind!=='EARTHQUAKE'&&<p role="status">{t.unsupported}</p>}
    <div className="lab-agent-actions">
      <button type="button" className="primary" disabled={busy||!accessKey.trim()||input.kind!=='EARTHQUAKE'} onClick={()=>void run()}>{t.run}</button>
      {busy&&<button type="button" onClick={stop}>{t.stop}</button>}
    </div>
    {!accessKey.trim()&&<p className="lab-muted">{t.missing}</p>}
    {busy&&<p role="status">{t.wait} · {state?.current_step??0}/{state?.total_steps??'…'}</p>}
    {complete&&<p role="status">{t.complete}</p>}
    {error&&<p role="alert" className="lab-drill-warning">{error}</p>}
    {snapshot&&<section className="lab-agent-results" aria-label={t.status}>
      <strong>{ai}</strong>
      <p>{t.status}: {state?.current_step}/{state?.total_steps} · {snapshot.situation.network_state} · {snapshot.source.status}</p>
      <p className="lab-hard-gates">{t.blocked}: {String(snapshot.spatial_guidance.movement_authorized)}</p>
      <h3>{t.actions}</h3>
      {actions.map(action=><article key={action.id} className="lab-drill-action">
        <b>{action.category} · {action.safety_decision}</b>
        <p>{action.text}</p>
      </article>)}
      <details><summary>{t.evidence} ({snapshot.evidence.length})</summary>
        {snapshot.evidence.map(e=><p key={e.id}><strong>SIMULATED · {e.source_name}</strong> · {e.summary} · {e.freshness_status}</p>)}
      </details>
      <details><summary>{t.trace} ({snapshot.trace.length})</summary>
        {snapshot.trace.map(e=><p key={e.id}><b>{e.event_type}</b> · {e.status} — {e.public_summary}</p>)}
      </details>
    </section>}
  </div>;
}
