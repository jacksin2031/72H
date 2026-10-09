'use client';

import { useMemo, useState } from 'react';
import type { Language, LiveProfileSeed } from '@/lib/contracts';
import { areaPath, type AreaEntry } from '@/lib/area-geometry';
import { loadAreaCatalog, resolveDeviceArea } from '@/lib/area-resolution';
import { isGpsObservationCurrent } from '@/lib/location-freshness';
import type { DeviceLocation } from '@/lib/use-device-location';

export type OnboardingLocation = {
  label: string;
  area_ids: string[];
  observed_at: string;
  source: 'GPS' | 'USER_SELECTED';
  accuracy_m?: number;
  broad?: boolean;
};

export function buildInitialLocationProfile(current: OnboardingLocation): LiveProfileSeed {
  return {
    current_location: {
      label: current.label,
      lat: null,
      lng: null,
      area_ids: current.area_ids,
      observed_at: current.observed_at,
      source: current.source,
    },
    accommodation_location: { label: '未設定', lat: null, lng: null, area_ids: [], observed_at: null, source: null },
    current_destination: null,
    party_size: 1,
    self_reported_safety_status: 'UNKNOWN',
    current_plan_summary: '',
    accessibility_constraints: [],
  };
}

function selectedPath(id: string, catalog: AreaEntry[]) {
  const ids = areaPath(id, catalog);
  const byId = new Map(catalog.map(entry => [entry.id, entry]));
  const label = ids.filter(areaId => areaId !== 'JP').reverse().map(areaId => byId.get(areaId)?.label).filter(Boolean).join(' ');
  return { area_ids: ids, label };
}

export function AreaFallbackPicker({ messages, disabled = false, buttonLabel, onConfirm }: {
  messages: Record<string, string>;
  disabled?: boolean;
  buttonLabel?: string;
  onConfirm: (location: OnboardingLocation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<AreaEntry[]>([]);
  const [prefectureId, setPrefectureId] = useState('');
  const [municipalityId, setMunicipalityId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const prefectures = useMemo(() => catalog.filter(entry => entry.parent_id === 'JP' && /^JP-\d{2}$/.test(entry.id)), [catalog]);
  const municipalities = useMemo(() => catalog.filter(entry => entry.parent_id === prefectureId && /^JP-MUNI-\d{5}$/.test(entry.id)), [catalog, prefectureId]);

  const show = async () => {
    setLoading(true); setError(false);
    try { setCatalog(await loadAreaCatalog()); setOpen(true); }
    catch { setError(true); }
    finally { setLoading(false); }
  };
  const confirm = () => {
    const selected = municipalityId || prefectureId;
    if (!selected) return;
    const path = selectedPath(selected, catalog);
    if (!path.area_ids.length || !path.label) { setError(true); return; }
    onConfirm({ label: path.label, area_ids: path.area_ids, observed_at: new Date().toISOString(), source: 'USER_SELECTED' });
  };

  return <section className="location-area-picker location-area-picker-recovery">
    {!open && <button type="button" disabled={disabled || loading} onClick={() => void show()}>
      {loading ? messages.locationResolving : buttonLabel ?? messages.locationChooseArea}
    </button>}
    {error && <p role="alert">{messages.areaCatalogUnavailable}</p>}
    {open && <>
      <label htmlFor="recovery-prefecture">{messages.locationPrefecture}</label>
      <select id="recovery-prefecture" disabled={disabled} value={prefectureId} onChange={event => { setPrefectureId(event.target.value); setMunicipalityId(''); }}>
        <option value="">{messages.locationChoosePrefecture}</option>
        {prefectures.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
      <label htmlFor="recovery-municipality">{messages.locationMunicipality}</label>
      <select id="recovery-municipality" disabled={disabled || !prefectureId || municipalities.length === 0} value={municipalityId}
        onChange={event => setMunicipalityId(event.target.value)}>
        <option value="">{messages.locationPrefectureOnly}</option>
        {municipalities.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
      <button type="button" className="primary location-primary-action" disabled={disabled || !prefectureId} onClick={confirm}>{messages.locationConfirmArea}</button>
    </>}
  </section>;
}

export function LocationOnboarding({ language, messages, location, busy, canStart, submit }: {
  language: Language;
  messages: Record<string, string>;
  location: DeviceLocation;
  busy: boolean;
  canStart: boolean;
  submit: (profile: LiveProfileSeed) => void;
}) {
  const [screen, setScreen] = useState<'intro' | 'fallback' | 'confirmed'>('intro');
  const [confirmed, setConfirmed] = useState<OnboardingLocation | null>(null);
  const [catalog, setCatalog] = useState<AreaEntry[]>([]);
  const [prefectureId, setPrefectureId] = useState('');
  const [municipalityId, setMunicipalityId] = useState('');
  const [resolving, setResolving] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [expiredGpsConfirmation, setExpiredGpsConfirmation] = useState(false);

  const prefectures = useMemo(() => catalog.filter(entry => entry.parent_id === 'JP' && /^JP-\d{2}$/.test(entry.id)), [catalog]);
  const municipalities = useMemo(() => catalog.filter(entry => entry.parent_id === prefectureId && /^JP-MUNI-\d{5}$/.test(entry.id)), [catalog, prefectureId]);
  const gpsConfirmationExpired = confirmed?.source === 'GPS'
    && (!isGpsObservationCurrent(confirmed.observed_at, location.now || Date.now()) || expiredGpsConfirmation);

  const requestLocation = async () => {
    setLocationMessage(''); setResolving(true);
    try {
      const fix = await location.locate();
      if (!fix) { setLocationMessage(location.permissionDenied ? messages.locationPermissionDenied : messages.locationUnavailable); return; }
      const resolved = await resolveDeviceArea({ latitude: fix.latitude, longitude: fix.longitude, accuracy_m: fix.accuracy_m });
      if (!['RESOLVED', 'AMBIGUOUS'].includes(resolved.status) || !resolved.area_ids.length || !resolved.label) {
        setLocationMessage(resolved.status === 'OUTSIDE' ? messages.locationOutside : messages.locationUnavailable);
        return;
      }
      const observedAt = new Date(fix.captured_at).toISOString();
      if (!isGpsObservationCurrent(observedAt, Date.now())) {
        setLocationMessage(messages.locationFixExpired);
        return;
      }
      setExpiredGpsConfirmation(false);
      setConfirmed({ label: resolved.label, area_ids: resolved.area_ids, observed_at: observedAt, source: 'GPS', accuracy_m: fix.accuracy_m, broad: resolved.status === 'AMBIGUOUS' });
      setScreen('confirmed');
    } catch {
      setLocationMessage(messages.locationUnavailable);
    } finally { setResolving(false); }
  };

  const openFallback = async () => {
    setLocationMessage(''); setCatalogFailed(false); setCatalogLoading(true);
    try {
      const entries = await loadAreaCatalog();
      setCatalog(entries); setScreen('fallback');
    } catch {
      setCatalogFailed(true); setLocationMessage(messages.areaCatalogUnavailable);
    } finally { setCatalogLoading(false); }
  };

  const confirmFallback = () => {
    const selected = municipalityId || prefectureId;
    if (!selected || !catalog.length) return;
    const path = selectedPath(selected, catalog);
    if (!path.area_ids.length || !path.label) { setLocationMessage(messages.areaCatalogUnavailable); return; }
    setExpiredGpsConfirmation(false);
    setConfirmed({ label: path.label, area_ids: path.area_ids, observed_at: new Date().toISOString(), source: 'USER_SELECTED' });
    setLocationMessage(''); setScreen('confirmed');
  };

  const emergencyBasics = <section className="onboarding-emergency" aria-labelledby="onboarding-emergency-title">
    <h2 id="onboarding-emergency-title">{messages.emergencyBasics}</h2>
    <p>{messages.emergencyBasicsText}</p>
    <p><a href="tel:119">119</a> · <a href="tel:110">110</a></p>
  </section>;

  return <section className="location-onboarding" aria-labelledby="location-onboarding-title">
    <p className="onboarding-progress">{messages.setup}</p>
    <h1 id="location-onboarding-title" tabIndex={-1}>{messages.locationOnboardingTitle}</h1>
    <p className="location-onboarding-intro">{messages.locationOnboardingText}</p>
    <details className="location-privacy-details">
      <summary>{messages.locationPrivacySummary}</summary>
      <p className="location-privacy-note">{messages.locationPrivacy}</p>
    </details>

    {emergencyBasics}

    {screen === 'intro' && <div className="location-onboarding-actions">
      <button type="button" className="primary location-primary-action" disabled={!location.ready || location.busy || resolving}
        onClick={() => void requestLocation()}>{resolving || location.busy ? messages.locationResolving : messages.locationLocate}</button>
      <button type="button" disabled={catalogLoading || resolving} onClick={() => void openFallback()}>
        {catalogLoading ? messages.locationResolving : messages.locationChooseArea}
      </button>
      {locationMessage && <p className="error" role="alert">{locationMessage}</p>}
      {location.failed && !locationMessage && <p role="status">{messages.locationUnavailable}</p>}
      {location.permissionDenied && <p role="status">{messages.locationPermissionDenied}</p>}
      {location.consent && <p role="status">{messages.locationSavedConsent}</p>}
    </div>}

    {screen === 'fallback' && <div className="location-area-picker">
      <label htmlFor="location-prefecture">{messages.locationPrefecture}</label>
      <select id="location-prefecture" value={prefectureId} onChange={event => { setPrefectureId(event.target.value); setMunicipalityId(''); setLocationMessage(''); }}>
        <option value="">{messages.locationChoosePrefecture}</option>
        {prefectures.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
      <label htmlFor="location-municipality">{messages.locationMunicipality}</label>
      <select id="location-municipality" value={municipalityId} disabled={!prefectureId || municipalities.length === 0}
        onChange={event => { setMunicipalityId(event.target.value); setLocationMessage(''); }}>
        <option value="">{messages.locationPrefectureOnly}</option>
        {municipalities.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
      <p>{messages.locationAreaFallbackNote}</p>
      {catalogFailed && <p role="alert">{messages.areaCatalogUnavailable}</p>}
      {locationMessage && <p role="alert">{locationMessage}</p>}
      <div className="location-onboarding-actions">
        <button type="button" onClick={() => { setScreen('intro'); setLocationMessage(''); }}>{messages.back}</button>
        <button type="button" className="primary location-primary-action" disabled={!prefectureId || busy} onClick={confirmFallback}>{messages.locationConfirmArea}</button>
      </div>
    </div>}

    {screen === 'confirmed' && confirmed && <section className="location-confirmation" aria-labelledby="location-confirmation-title" aria-live="polite">
      <h2 id="location-confirmation-title">{messages.locationConfirmedTitle}</h2>
      <dl>
        <div><dt>{messages.area}</dt><dd>{confirmed.label}</dd></div>
        <div><dt>{messages.locationCheckedAt}</dt><dd>{new Date(confirmed.observed_at).toLocaleString(language, { timeZone: 'Asia/Tokyo' })}</dd></div>
        {confirmed.source === 'GPS' && confirmed.accuracy_m !== undefined && <div><dt>{messages.locationAccuracy}</dt><dd>±{Math.round(confirmed.accuracy_m)} m</dd></div>}
        <div><dt>{messages.locationMethod}</dt><dd>{confirmed.source === 'GPS' ? messages.locationMethodGps : messages.locationMethodSelected}</dd></div>
      </dl>
      {confirmed.broad && <p className="location-area-broad" role="status">{messages.locationAreaBroad}</p>}
      {gpsConfirmationExpired && <p className="location-freshness-warning" role="alert">{messages.locationFixExpired}</p>}
      {locationMessage && !gpsConfirmationExpired && <p className="location-freshness-warning" role="alert">{locationMessage}</p>}
      {confirmed.source === 'GPS' && !location.consent && <label className="location-retain-choice">
        <input type="checkbox" checked={false} onChange={event => location.retain(event.target.checked)} /> {messages.locationRetainChoice}
      </label>}
      {confirmed.source === 'GPS' && location.consent && <label className="location-retain-choice">
        <input type="checkbox" checked onChange={event => location.retain(event.target.checked)} /> {messages.locationRetainChoice}
      </label>}
      <div className="location-onboarding-actions">
        <button type="button" onClick={() => { setScreen('intro'); setConfirmed(null); setLocationMessage(''); setExpiredGpsConfirmation(false); }}>{messages.locationChooseAgain}</button>
        <button type="button" className="primary location-primary-action" disabled={!canStart || busy
          || gpsConfirmationExpired}
          onClick={() => {
            if (confirmed.source === 'GPS' && !isGpsObservationCurrent(confirmed.observed_at, Date.now())) {
              setExpiredGpsConfirmation(true); setLocationMessage(messages.locationFixExpired); return;
            }
            setLocationMessage('');
            submit(buildInitialLocationProfile(confirmed));
          }}>{busy ? messages.refreshing : messages.locationStart72h}</button>
      </div>
      {!canStart && !busy && <p role="status">{messages.locationStartNeedsNetwork}</p>}
    </section>}
  </section>;
}
