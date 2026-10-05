'use client';
import { useEffect, useState } from 'react';
import type { Language } from '@/lib/contracts';
import { replayScenarioListSchema } from '@/lib/replay-scenarios';
import { vnextMessages } from '@/lib/vnext-i18n';

export function ScenarioPicker({ language, currentKey, enabled, busy, button, start }: { language: Language; currentKey?: string; enabled: boolean; busy: boolean; button: string; start: (key: string) => void }) {
  const [items, setItems] = useState<{ key: string; name: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [failed, setFailed] = useState(false);
  const t = vnextMessages[language];
  useEffect(() => {
    if (!enabled || !navigator.onLine) return;
    const controller = new AbortController();
    void fetch('/api/replay/scenarios', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Scenario catalog unavailable');
      const raw = await response.text();
      if (raw.length > 8000) throw new Error('Oversized scenario catalog');
      const approved = replayScenarioListSchema.parse(JSON.parse(raw));
      if (!controller.signal.aborted) { setItems(approved); setFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [enabled]);
  useEffect(() => { if (items.length) setSelected(items.some(item => item.key === currentKey) ? currentKey! : items[0].key); }, [items, currentKey]);
  return <div className="scenario-picker"><label>{t.scenarioSelect}<select aria-label={t.scenarioSelect} value={selected} disabled={!enabled || busy || !items.length} onChange={event => setSelected(event.target.value)}>{items.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label><button className="primary" disabled={!enabled || busy || !items.some(item => item.key === selected)} onClick={() => start(selected)}>{busy ? '…' : button} →</button>{failed && <p role="status">{t.scenarioUnavailable}</p>}</div>;
}
