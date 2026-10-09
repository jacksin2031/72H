import type { Language } from '@/lib/contracts';
import type { PowerProjection } from '@/lib/vnext';
import { vnextMessages } from '@/lib/vnext-i18n';
import { adaptiveMessages } from '@/lib/adaptive-i18n';

export function PowerControls({ language, power, level, override, choose }: { language: Language; power: PowerProjection; level: number | null; override: string; choose: (value: string) => void }) {
  const t = vnextMessages[language];
  const labels = adaptiveMessages[language];
  const modeLabel = power.mode === 'CONSERVE' ? labels.powerConserve
    : power.mode === 'EMERGENCY_POWER' ? labels.powerEmergency
      : power.mode === 'SURVIVAL' ? labels.powerSurvival : labels.powerNormal;
  return <section className="power-controls"><label>{t.power} <select aria-label={t.power} value={override} onChange={e => choose(e.target.value)}>
    <option value="AUTO">{t.auto}</option><option value="CONSERVE">{labels.powerConserve}</option>
    <option value="EMERGENCY_POWER">{labels.powerEmergency}</option><option value="SURVIVAL">{labels.powerSurvival}</option>
  </select></label><span>{labels.powerEffective}: {modeLabel} · {power.batteryKnown && level !== null ? `${Math.round(level)}%` : t.batteryUnknown}</span><p className="muted">{t.reserve}</p></section>;
}
