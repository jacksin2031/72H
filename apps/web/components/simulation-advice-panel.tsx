'use client';
import type { Language } from '@/lib/contracts';
import { simulationAdviceText, type SimulationAssessment } from '@/lib/simulation-advice';
import { simulationConditionText } from './simulation-location-controls';

export function SimulationAdvicePanel({advice,language,stale=false,cannotMove=false,executionMode}:{advice:SimulationAssessment|null;language:Language;stale?:boolean;cannotMove?:boolean;executionMode?:SimulationAssessment['ai_mode']}){
  const t=simulationAdviceText[language],c:Record<string,string>=simulationConditionText[language];
  const model=advice?.ai_mode??executionMode;
  return <section className="sim-advice-panel" data-testid="simulation-advice-panel" aria-live="polite">
    <h2>{t.title}</h2><small data-testid="simulation-ai-mode">{stale&&model!=='NOT_RUN'?language==='zh-TW'?'最近一次執行：':language==='ja'?'直近の実行：':'Last execution: ':''}{model==='GEMINI_ADK'?t.success:model==='GEMINI_ADK_FALLBACK'?t.fallback:t.notRun}</small>
    {stale&&<p data-testid="simulation-advice-unavailable">{t.expired}</p>}
    <strong data-testid="simulation-location-decision">{t[advice?.decision??'UNKNOWN']}</strong>
    {cannotMove&&<p data-testid="simulation-basic-assistance">{t.ASSISTANCE}</p>}
    <p>{t.area}: {advice?.area_label||t.unknownArea}{advice?.location_source==='GPS'?' · '+t.gps:advice?.location_source==='USER_SELECTED'?' · '+t.manual:''}</p>
    <p>{t.assumptions}</p><p>{t.limits}</p>
    {advice&&<details><summary>{t.facts}</summary><ul>{advice.facts.map(f=><li key={f.id}>
      {c[f.id.toLowerCase()]??f.id}: {c[f.value]??f.value}
    </li>)}</ul><small>{advice.created_at} → {advice.expires_at} · #{advice.step} · {advice.version.slice(0,12)}</small>
      {advice.reason_code&&<small>{advice.reason_code}</small>}</details>}
  </section>;
}
