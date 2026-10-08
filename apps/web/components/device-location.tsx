'use client';
import type { Language } from '@/lib/contracts';
import type { DeviceLocation } from '@/lib/use-device-location';
import { vnextMessages } from '@/lib/vnext-i18n';

export function DeviceLocationControls({ location, language }: { location: DeviceLocation; language: Language }) {
  const t = vnextMessages[language];
  return <section className="device-location" aria-label={t.deviceLocation}>
    <strong>{t.locationStates[location.state]}</strong>
    {location.position && <p>{new Date(location.position.captured_at).toLocaleString(language, { timeZone: 'Asia/Tokyo' })} · ±{Math.round(location.position.accuracy_m)} m</p>}
    <label><input type="checkbox" checked={location.consent} disabled={!location.ready} onChange={e => location.retain(e.target.checked)} /> {t.retainLocation}</label>
    <div><button disabled={!location.ready || location.busy} onClick={location.locate}>{t.locate}</button>{(location.position || location.consent) && <button onClick={() => location.retain(false)}>{t.forgetLocation}</button>}</div>
    {location.failed && <p role="status">{t.locationFailed}</p>}
    {location.storageUnavailable && <p role="status">{t.locationStorageUnavailable}</p>}
    <p className="muted">{t.locationPrivacy}</p>
  </section>;
}
