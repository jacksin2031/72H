import type { Language } from '@/lib/contracts';
import type { PowerProjection } from '@/lib/vnext';
import { vnextMessages } from '@/lib/vnext-i18n';

export function PowerControls({ language, power, level, override, choose }: { language: Language; power: PowerProjection; level: number | null; override: string; choose: (value: string) => void }) {
  const t = vnextMessages[language];
  return <section className="power-controls"><label>{t.power} <select aria-label={t.power} value={override} onChange={e => choose(e.target.value)}><option value="AUTO">{t.auto}</option><option value="CONSERVE">CONSERVE</option><option value="EMERGENCY_POWER">EMERGENCY POWER</option><option value="SURVIVAL">SURVIVAL</option></select></label><span>{power.mode} · {power.batteryKnown && level !== null ? `${Math.round(level)}%` : t.batteryUnknown}</span><p className="muted">{t.reserve}</p></section>;
}
