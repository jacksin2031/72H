'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import { usePower } from '@/lib/use-power';
import { useDeviceLocation } from '@/lib/use-device-location';
import { useTheme } from '@/lib/use-theme';
import { useDeviceRole } from '@/lib/device-role';
import { adaptiveMessages } from '@/lib/adaptive-i18n';
import { liveMessages } from '@/lib/live-i18n';
import { liveProfileSeedSchema, type Language, type LiveProfileSeed, type LiveSnapshot, type Location, type Snapshot } from '@/lib/contracts';
import { loadLiveSnapshot, saveLiveSnapshot } from '@/lib/continuity';
import { canReconcileLiveSnapshot, isPrimarySourceCurrent, liveRouteNotification, nextLiveSafetyDeadline, projectLiveSnapshot, shouldRenderCandidateRoutePreview, shouldUseCriticalMobileTakeover } from '@/lib/live-presentation';
import { publicHandoffUrl } from '@/lib/live-handoff';
import { isMissingLiveSessionError, refreshLiveSession, searchLiveRoute, startLiveSession } from '@/lib/live-api';
import { deriveNotifications, deriveSeverity, initialSafetyCheck, reduceSafetyCheck, safetyCheckSchema, type Notification, type SafetyCheckState } from '@/lib/vnext';
import { aggregateNotifications, notificationLedgerSchema } from '@/lib/notification-inbox';
import { mapCatalogSchema, verifyMapPack } from '@/lib/offline-map';
import { requiredCachedPageAssets } from '@/lib/offline-readiness';
import { AdaptiveHome } from './adaptive-home';
import { EmergencyMap } from './emergency-map';
import { PowerControls } from './power-controls';
import { DeviceLocationControls } from './device-location';

type Connection = 'online' | 'offline' | 'reconnecting';
type AreaChoice = '' | 'JP-13' | 'JP-27';

function reducerSnapshot(snapshot: LiveSnapshot): Snapshot {
  // The existing deterministic reducers need a replay cursor only for event identity.
  // This adapter stays in memory and preserves mode: LIVE; it is never cached or rendered.
  return {
    ...snapshot,
    replay: { id: snapshot.session_id, scenario_key: 'live', status: 'PAUSED', speed: 1,
      current_event_index: 0, current_time: snapshot.situation.updated_at, mode: 'SYNTHETIC_REPLAY', planning_mode: 'LIVE_REDUCER_ADAPTER' },
    scenario_events: [], mobility: [],
  } as unknown as Snapshot;
}

function location(label: string, area: AreaChoice): Location {
  return { label: label.trim(), lat: null, lng: null, area_ids: area ? [area, 'JP'] : [], observed_at: null };
}

function displayTime(value: string | null, language: Language) {
  return value ? new Date(value).toLocaleString(language, { timeZone: 'Asia/Tokyo' }) : '—';
}

function HandoffCard({ link, messages }: { link: string | null; messages: Record<string, string> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link || !navigator.clipboard?.writeText) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };
  return <section className="handoff-card"><h2>{messages.handoff}</h2><p>{messages.handoffText}</p>
    {link ? <div className="handoff-actions"><a className="primary" href={link}>{messages.openMobile} ↗</a>
      <button type="button" onClick={() => void copy()}>{copied ? messages.copied : messages.copyLink}</button></div>
      : <p className="muted" role="status">{messages.handoffUnavailable}</p>}
  </section>;
}

function OfflineReadinessPanel({ messages }: { messages: Record<string, string> }) {
  const [status, setStatus] = useState<{ checked: boolean; screen: boolean; runtime: boolean; maps: string[] }>({ checked: false, screen: false, runtime: false, maps: [] });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!('caches' in window)) { if (!cancelled) setStatus({ checked: true, screen: false, runtime: false, maps: [] }); return; }
      try {
        const names = (await caches.keys()).filter(name => name.startsWith('72h-shell-'));
        let screen = false; let cachedPageAssets = false; const verifiedMaps: string[] = [];
        for (const name of names) {
          const cache = await caches.open(name);
          const page = await cache.match('/dashboard');
          if (page?.ok) {
            screen = true;
            const html = await page.clone().text();
            const assets = requiredCachedPageAssets(html, window.location.origin);
            const referencesScripts = assets.some(asset => asset.endsWith('.js'));
            const allAssetsCached = referencesScripts && assets.length > 0
              && (await Promise.all(assets.map(asset => cache.match(asset)))).every(asset => !!asset?.ok);
            const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
            const activeWorker = registration?.active?.state === 'activated';
            const mapWorkers = await Promise.all(['/maplibre/maplibre-gl-worker.mjs', '/maplibre/maplibre-gl-shared.mjs'].map(asset => cache.match(asset)));
            cachedPageAssets ||= allAssetsCached && activeWorker && mapWorkers.every(asset => !!asset?.ok);
          }
          const catalogResponse = await cache.match('/maps/catalog.json');
          if (!catalogResponse?.ok) continue;
          const parsed = mapCatalogSchema.safeParse(await catalogResponse.json());
          if (!parsed.success) continue;
          for (const pack of parsed.data.packs) {
            const cached = await cache.match(pack.asset);
            if (!cached?.ok) continue;
            try { await verifyMapPack(pack, await cached.arrayBuffer()); verifiedMaps.push(pack.id); } catch { /* Invalid cache does not count as ready. */ }
          }
        }
        if (!cancelled) setStatus({ checked: true, screen, runtime: cachedPageAssets, maps: [...new Set(verifiedMaps)] });
      } catch { if (!cancelled) setStatus({ checked: true, screen: false, runtime: false, maps: [] }); }
    })();
    return () => { cancelled = true; };
  }, []);
  return <section className="offline-readiness"><h2>{messages.offlineReadiness}</h2>
    {!status.checked ? <p>{messages.readinessUnknown}</p> : <>
      <p><strong>{status.screen ? messages.cachedScreen : messages.notReady}</strong></p>
      <p><strong>{status.runtime ? messages.appAssetsReady : messages.notReady}</strong></p>
      <p><strong>{status.maps.length ? messages.packReady : messages.notReady}</strong>{status.maps.length > 0 && <small> · {status.maps.join(', ')}</small>}</p>
    </>}
    <small>{messages.emergencyGuide}: {messages.guideAvailabilityUnknown}</small>
    <p>{messages.builtInGuide}</p>
    <small>{messages.replay}</small>
  </section>;
}

export function PlanHistory({ snapshot, projection, language, messages, now }: {
  snapshot: LiveSnapshot; projection: ReturnType<typeof projectLiveSnapshot>; language: Language;
  messages: Record<string, string>; now: number;
}) {
  const ordered = [...snapshot.plans].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  return <section className="plan-history"><h2>{messages.planHistory}</h2>
    {ordered.length ? ordered.map(plan => {
      const current = plan.id === snapshot.situation.current_plan_id;
      const evaluation = snapshot.plan_evaluations.findLast(item => item.plan_id === plan.id);
      const expired = plan.status === 'EXPIRED' || evaluation?.status === 'EXPIRED'
        || Date.parse(plan.expires_at) <= now || (current && projection.planStatus === 'EXPIRED');
      const invalid = !expired && (plan.status === 'INVALIDATED' || plan.status === 'PARTIALLY_INVALID'
        || evaluation?.status === 'INVALIDATED' || evaluation?.status === 'PARTIAL_INVALIDATION'
        || (current && ['INVALIDATED', 'PARTIALLY_INVALID'].includes(projection.planStatus)));
      const heading = expired ? messages.planExpired : invalid ? messages.planInvalid : current ? messages.currentVersion : messages.priorVersion;
      return <article key={plan.id} className={expired || invalid ? 'plan-history-stale' : undefined}>
        <div className="section-head"><strong>{heading} · v{plan.version}</strong><small>{messages.planCreated}: {displayTime(plan.created_at, language)}</small></div>
        {snapshot.plan_actions.filter(action => action.plan_id === plan.id).map(action => <p key={action.id}>
          <b>{messages[action.category] ?? action.category}</b>
          {(expired || invalid || action.status !== 'ACTIVE' || projection.invalidActionIds.includes(action.id)) && <> · <span>{messages.actionNeedsReview}</span></>} · {action.text}
        </p>)}
        {plan.invalidation_reason && <small>{plan.invalidation_reason}</small>}
        <small>{messages.planExpires}: {displayTime(plan.expires_at, language)}</small>
      </article>;
    }) : <p>{messages.noPlan}</p>}
  </section>;
}

function SafetyCheckControls({ check, setCheck, messages }: {
  check: SafetyCheckState; setCheck: Dispatch<SetStateAction<SafetyCheckState>>; messages: Record<string, string>;
}) {
  const active = ['AWAITING_RESPONSE', 'UNRESPONSIVE_UNKNOWN', 'NEEDS_ASSISTANCE', 'CANNOT_MOVE'].includes(check.status);
  return <section className={`check-card ${active ? 'check-required' : ''}`}>
    <label><input type="checkbox" checked={check.consent} onChange={event => setCheck(state => reduceSafetyCheck(state, { type: 'CONSENT', enabled: event.target.checked }))} /> {messages.safetyConsent}</label>
    {active && <><h3>{messages.safetyWaiting}</h3><p role="status">{check.status === 'UNRESPONSIVE_UNKNOWN' ? messages.safetyNoResponse : check.status === 'NEEDS_ASSISTANCE' ? messages.help : check.status === 'CANNOT_MOVE' ? messages.cannotMove : messages.safetyWaiting} · {check.attempts}/3</p>
      {(['AWAITING_RESPONSE', 'UNRESPONSIVE_UNKNOWN'].includes(check.status)) && <div className="check-buttons">{(['SAFE_CONFIRMED', 'NEEDS_ASSISTANCE', 'CANNOT_MOVE'] as const).map((response, index) => <button key={response} type="button" onClick={() => setCheck(state => reduceSafetyCheck(state, { type: 'RESPOND', response, now: Date.now() }))}>
        {[messages.safe, messages.help, messages.cannotMove][index]}</button>)}</div>}
    </>}
    <p className="muted">{messages.safetyLimit}</p>
  </section>;
}

function sessionRef(): string | null {
  try {
    const value = localStorage.getItem('72h-live-session');
    return value && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null;
  } catch { return null; }
}

function ProfileForm({ language, busy, submit, initial, startLabel, title, copy, messages }: {
  language: Language; busy: boolean; submit: (profile: LiveProfileSeed) => void; initial?: LiveSnapshot['profile'];
  startLabel: string; title: string; copy: string; messages: Record<string, string>;
}) {
  const [current, setCurrent] = useState(initial?.current_location.label ?? '');
  const [accommodation, setAccommodation] = useState(initial?.accommodation_location.label ?? '');
  const [currentArea, setCurrentArea] = useState<AreaChoice>((initial?.current_location.area_ids.find(id => id === 'JP-13' || id === 'JP-27') as AreaChoice) ?? '');
  const [accommodationArea, setAccommodationArea] = useState<AreaChoice>((initial?.accommodation_location.area_ids.find(id => id === 'JP-13' || id === 'JP-27') as AreaChoice) ?? '');
  const [partySize, setPartySize] = useState(initial?.party_size ?? 1);
  const [safety, setSafety] = useState<LiveProfileSeed['self_reported_safety_status']>(initial?.self_reported_safety_status ?? 'UNKNOWN');
  const [validationError, setValidationError] = useState(false);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = liveProfileSeedSchema.safeParse({
      current_location: location(current, currentArea), accommodation_location: location(accommodation, accommodationArea),
      current_destination: null, party_size: partySize, self_reported_safety_status: safety,
      current_plan_summary: '', accessibility_constraints: [],
    });
    if (!parsed.success) { setValidationError(true); return; }
    setValidationError(false);
    submit(parsed.data);
  };
  return <section className="live-profile-card">
    <h2>{title}</h2><p>{copy}</p>
    <form className="live-profile-form" onSubmit={onSubmit}>
      <label>{messages.currentLocation}<input required maxLength={160} value={current} onChange={event => setCurrent(event.target.value)} placeholder={messages.locationPlaceholder} /></label>
      <label>{messages.area}<select value={currentArea} onChange={event => setCurrentArea(event.target.value as AreaChoice)}><option value="">{messages.noArea}</option><option value="JP-13">{messages.tokyo}</option><option value="JP-27">{messages.osaka}</option></select></label>
      <label>{messages.accommodation}<input required maxLength={160} value={accommodation} onChange={event => setAccommodation(event.target.value)} placeholder={messages.locationPlaceholder} /></label>
      <label>{messages.area}<select value={accommodationArea} onChange={event => setAccommodationArea(event.target.value as AreaChoice)}><option value="">{messages.noArea}</option><option value="JP-13">{messages.tokyo}</option><option value="JP-27">{messages.osaka}</option></select></label>
      <label>{messages.profile}<select value={partySize} onChange={event => setPartySize(Number(event.target.value))}>{Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
      <label>{language === 'ja' ? '現在の状態（自己申告）' : language === 'zh-TW' ? '目前狀態（自行回報）' : 'Current status (self-reported)'}
        <select value={safety} onChange={event => setSafety(event.target.value as LiveProfileSeed['self_reported_safety_status'])}>
          <option value="UNKNOWN">{language === 'ja' ? '未回答' : language === 'zh-TW' ? '尚未回答' : 'Not reported'}</option>
          <option value="SAFE">{language === 'ja' ? '安全' : language === 'zh-TW' ? '安全' : 'Safe'}</option>
          <option value="UNCERTAIN">{language === 'ja' ? '不明' : language === 'zh-TW' ? '不確定' : 'Unsure'}</option>
          <option value="NEEDS_ASSISTANCE">{language === 'ja' ? '支援が必要' : language === 'zh-TW' ? '需要協助' : 'Needs assistance'}</option>
        </select>
      </label>
      <button className="primary" disabled={busy} type="submit">{busy ? messages.refreshing : startLabel}</button>
      {validationError && <p className="error" role="alert">{language === 'ja' ? '場所を入力してください。' : language === 'zh-TW' ? '請填寫地點。' : 'Enter both locations.'}</p>}
    </form>
  </section>;
}

function SourceSummary({ snapshot, language, messages, projection, compact = false }: {
  snapshot: LiveSnapshot; language: Language; messages: Record<string, string>; projection: ReturnType<typeof projectLiveSnapshot>; compact?: boolean;
}) {
  const sourceCurrent = isPrimarySourceCurrent(snapshot, projection);
  const status = sourceCurrent ? messages.sourceFresh : messages.sourceStale;
  const sources = [
    { source: snapshot.source, attribution: messages.attribution },
    { source: snapshot.destination_source, attribution: messages.destinationAttribution },
    { source: snapshot.route_source, attribution: messages.routeAttribution },
  ];
  return <section className="live-source-summary" aria-label={messages.source}>
    <div><span className={`source-indicator ${sourceCurrent ? 'source-current' : 'source-stale'}`} />
      <strong>{snapshot.source.source_name}</strong><span>{status}</span></div>
    <p>{messages.attribution} · {messages.sourceAge}: {displayTime(snapshot.source.retrieved_at, language)}</p>
    {!compact && <><p>{language === 'ja' ? '最終公開' : language === 'zh-TW' ? '最後發布' : 'Last published'}: {displayTime(snapshot.source.last_published_at, language)}</p>
      <div className="live-source-links">{sources.map(({ source, attribution: label }) => <p key={source.source_key}>
        <a href={source.source_url} target="_blank" rel="noreferrer">{source.source_name} · {messages.officialDetails}</a><small>{label}</small>
      </p>)}</div>
    </>}
  </section>;
}

function SourceReview({ snapshot, language, messages, projection }: {
  snapshot: LiveSnapshot; language: Language; messages: Record<string, string>; projection: ReturnType<typeof projectLiveSnapshot>;
}) {
  const evidence = [...projection.evidence].sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at));
  const route = projection.route;
  const routeLabel = route?.status === 'EXPIRED' ? messages.routeExpired
    : route?.freshness_status !== 'CURRENT' && route ? messages.routeStale
    : route?.status === 'VERIFIED_USABLE' ? messages.mapLabel
    : route?.status === 'CANDIDATE' ? messages.routeAttribution
      : route?.status === 'BLOCKED' || route?.status === 'AFFECTED' ? messages.mapGateClosed : messages.gateRoute;
  return <div className="live-review-list">
    <SourceSummary snapshot={snapshot} language={language} messages={messages} projection={projection} />
    <section className="record-list"><h2>{language === 'ja' ? '確認済み情報' : language === 'zh-TW' ? '已核對資訊' : 'Reviewed information'}</h2>
      {evidence.map(item => {
        const sourceForEvidence = [snapshot.source, snapshot.destination_source, snapshot.route_source].find(source => source.source_key === item.source_key);
        return <article key={item.id}>
          <div className="section-head"><h3>{item.source_name}</h3><span>{item.freshness_status === 'CURRENT' ? messages.sourceFresh : messages.stale}</span></div>
          <p>{item.summary}</p><small>{displayTime(item.published_at, language)} · {sourceForEvidence?.source_name ?? messages.source}</small>
          {sourceForEvidence && <p><a href={sourceForEvidence.source_url} target="_blank" rel="noreferrer">{messages.officialDetails}</a></p>}
        </article>;
      })}
      {!evidence.length && <p>{messages.pending}</p>}
    </section>
    <section className="record-list"><h2>{language === 'ja' ? '目的地候補' : language === 'zh-TW' ? '目的地清單' : 'Listed destinations'}</h2>
      {snapshot.destinations.map(item => <article key={item.id}><h3>{item.name}</h3><p>{item.address || item.area_id}</p>
        <p>{messages.mapOpen} · {item.source_name}</p><a href={item.source_url} target="_blank" rel="noreferrer">{messages.officialDetails}</a>
      </article>)}
      {!snapshot.destinations.length && <p>{messages.gateDestination}</p>}
    </section>
    <section className="route-review" aria-label={messages.routeAttribution}><h2>{messages.routeAttribution}</h2><p>{routeLabel}</p>
      {route && <><p>{route.presentation_label}</p><p>{displayTime(route.checked_at, language)}</p>
        {route.geometry_kind === 'TRANSIT_STATION_SEQUENCE' && <p>{messages.routeAttribution}</p>}
        {route.waypoints.length > 0 && <p>{route.waypoints.join(' → ')}</p>}
      </>}
      {!projection.mapGate && <p className="muted">{messages.mapGateClosed}</p>}
    </section>
  </div>;
}

function RoutePreview({ snapshot, projectedRoute, language, messages, busy, connection, now, location: deviceLocation,
  power, search }: {
  snapshot: LiveSnapshot; language: Language; messages: Record<string, string>; busy: boolean; connection: Connection; now: number;
  projectedRoute: ReturnType<typeof projectLiveSnapshot>['route'];
  location: ReturnType<typeof useDeviceLocation>; power: ReturnType<typeof usePower>['power']; search: (origin: Location, destinationId: string) => Promise<boolean>;
}) {
  const [originLabel, setOriginLabel] = useState(snapshot.profile.current_location.label);
  const [originLatitude, setOriginLatitude] = useState(snapshot.profile.current_location.lat === null ? '' : String(snapshot.profile.current_location.lat));
  const [originLongitude, setOriginLongitude] = useState(snapshot.profile.current_location.lng === null ? '' : String(snapshot.profile.current_location.lng));
  const [destinationId, setDestinationId] = useState(snapshot.destinations[0]?.id ?? '');
  const [requestedOrigin, setRequestedOrigin] = useState(snapshot.profile.current_location.label);
  const [requestedOriginCoordinates, setRequestedOriginCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [consent, setConsent] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const route = projectedRoute;
  const candidateDestination = route ? snapshot.destinations.find(item => item.id === route.destination_id) : undefined;
  const routeFresh = !!route && route.status === 'CANDIDATE' && route.freshness_status === 'CURRENT'
    && !route.conflict && Date.parse(route.checked_at) <= now && Date.parse(route.expires_at) > now
    && snapshot.route_source.status === 'FRESH' && Date.parse(snapshot.route_source.retrieved_at ?? '') <= now;
  const previewAllowed = routeFresh && !!route?.geometry
    && ['PROVIDER_GEOMETRY', 'TRANSIT_STATION_SEQUENCE'].includes(route.geometry_kind)
    && !!candidateDestination && candidateDestination.id === route.destination_id;
  const latitude = originLatitude.trim() ? Number(originLatitude) : Number.NaN;
  const longitude = originLongitude.trim() ? Number(originLongitude) : Number.NaN;
  const validOriginCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  useEffect(() => {
    setOriginLabel(snapshot.profile.current_location.label); setRequestedOrigin(snapshot.profile.current_location.label);
    setOriginLatitude(snapshot.profile.current_location.lat === null ? '' : String(snapshot.profile.current_location.lat));
    setOriginLongitude(snapshot.profile.current_location.lng === null ? '' : String(snapshot.profile.current_location.lng));
    setRequestedOriginCoordinates(null);
    setDestinationId(snapshot.destinations[0]?.id ?? ''); setConsent(false); setPreviewOpen(false);
  }, [snapshot.session_id]);
  useEffect(() => { if (!snapshot.destinations.some(item => item.id === destinationId)) setDestinationId(snapshot.destinations[0]?.id ?? ''); }, [snapshot.destinations, destinationId]);
  useEffect(() => setPreviewOpen(false), [route?.id, route?.checked_at]);
  useEffect(() => { if (!power.allowMap) setPreviewOpen(false); }, [power.allowMap]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setRequestError(false); setPreviewOpen(false);
    if (!consent || !originLabel.trim() || !destinationId || !validOriginCoordinates) return;
    const approvedOrigin: Location = { ...snapshot.profile.current_location, label: originLabel.trim(),
      lat: latitude, lng: longitude, observed_at: null };
    setRequestedOrigin(originLabel.trim());
    setRequestedOriginCoordinates({ lat: latitude, lng: longitude });
    setConsent(false);
    setRequestError(!(await search(approvedOrigin, destinationId)));
  };
  return <section className="route-preview-card"><h2>{messages.routeAttribution}</h2>
    <form className="route-search-form" onSubmit={submit}>
      <label>{messages.routeOrigin}<input required maxLength={160} value={originLabel} onChange={event => { setOriginLabel(event.target.value); setConsent(false); }} /></label>
      <div className="route-coordinate-fields">
        <label>{messages.routeOriginLat}<input required type="number" inputMode="decimal" step="any" min="-90" max="90" value={originLatitude} onChange={event => { setOriginLatitude(event.target.value); setConsent(false); }} /></label>
        <label>{messages.routeOriginLng}<input required type="number" inputMode="decimal" step="any" min="-180" max="180" value={originLongitude} onChange={event => { setOriginLongitude(event.target.value); setConsent(false); }} /></label>
      </div>
      <label>{messages.routeDestination}<select value={destinationId} onChange={event => { setDestinationId(event.target.value); setConsent(false); }}>
        <option value="">{messages.gateDestination}</option>{snapshot.destinations.map(item => <option key={item.id} value={item.id}>{item.name} · {item.area_id}</option>)}
      </select></label>
      <label className="route-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{messages.routeConsent}</label>
      <button type="submit" disabled={busy || connection === 'offline' || !power.allowNonCriticalNetwork || !consent || !destinationId || !validOriginCoordinates}>{busy ? messages.refreshing : messages.searchRoute}</button>
      {requestError && <p className="error" role="alert">{messages.routeUnavailable}</p>}
    </form>
    {route && <div className="route-candidate-summary"><strong>{route.status === 'EXPIRED' ? messages.routeExpired : route.presentation_label}</strong><p>{messages.routeAttribution} · {displayTime(route.checked_at, language)}</p>
      {route.geometry_kind === 'TRANSIT_STATION_SEQUENCE' && <p>{messages.stationSequence}</p>}
      {route.waypoints.length > 0 && <p>{route.waypoints.join(' → ')}</p>}
      {route.geometry && ['PROVIDER_GEOMETRY', 'TRANSIT_STATION_SEQUENCE'].includes(route.geometry_kind) && <button type="button" disabled={!previewAllowed || !power.allowMap} onClick={() => setPreviewOpen(open => !open)}>
        {previewOpen ? messages.closePreview : messages.routePreview}
      </button>}
      {shouldRenderCandidateRoutePreview(previewOpen, previewAllowed, power.allowMap) && <><p className="route-candidate-warning" role="status">{messages.candidatePreview}</p>
        <EmergencyMap language={language} conserve={power.mode !== 'NORMAL'}
          originRef={requestedOrigin} routeOrigin={requestedOriginCoordinates ? { label: requestedOrigin, ...requestedOriginCoordinates } : null}
          location={deviceLocation} route={route}
          routeDestination={candidateDestination ? { id: candidateDestination.id, name: candidateDestination.name,
            lng: candidateDestination.coordinates.lng, lat: candidateDestination.coordinates.lat } : null} />
      </>}
      {!previewAllowed && <small role="status">{messages.gateRoute}</small>}
    </div>}
    {!snapshot.destinations.length && <p>{messages.gateDestination}</p>}
  </section>;
}

function NotificationsScene({ notifications, messages, dismiss }: {
  notifications: Notification[]; messages: Record<string, string>; dismiss: (id: string) => void;
}) {
  return <section className="live-plan-scene live-notifications"><h1>{messages.notifications}</h1>
    <div aria-live="polite">{notifications.length ? notifications.map(item => <article key={item.id}>
      <Link href={item.href}>{messages[item.event] ?? messages.pending}</Link>
      <button type="button" onClick={() => dismiss(item.id)}>{messages.dismiss}</button>
    </article>) : <p>{messages.noNotifications}</p>}</div>
  </section>;
}

function MobileScene({ view, snapshot, language, messages, projection, deviceLocation, power, level, override, choose, theme, chooseTheme,
  busy, onProfile, onRefresh, onRouteSearch, link, now, connection, check, setCheck, notifications, dismissNotification, sessionLost }: {
  view: string; snapshot: LiveSnapshot | null; language: Language; messages: Record<string, string>;
  projection: ReturnType<typeof projectLiveSnapshot> | null; deviceLocation: ReturnType<typeof useDeviceLocation>;
  power: ReturnType<typeof usePower>['power']; level: number | null; override: string; choose: (value: string) => void;
  theme: string; chooseTheme: (value: string) => void; busy: boolean; onProfile: (profile: LiveProfileSeed) => void; onRefresh: () => void;
  onRouteSearch: (origin: Location, destinationId: string) => Promise<boolean>; link: string | null; now: number; connection: Connection;
  check: SafetyCheckState; setCheck: Dispatch<SetStateAction<SafetyCheckState>>; notifications: Notification[]; dismissNotification: (id: string) => void; sessionLost: boolean;
}) {
  if (!snapshot || !projection) return <ProfileForm language={language} busy={busy} submit={onProfile} startLabel={messages.begin} title={messages.startTitle} copy={messages.startText} messages={messages} />;
  const urgent = ['SAFETY_CHECK', 'EMERGENCY_PROTECT', 'SURVIVAL', 'MAP_ASSISTED'].includes(projection.presentation.mode)
    || ['SHELTER_IN_PLACE', 'EVACUATE'].includes(snapshot.spatial_guidance.current_action_kind);
  const currentPlan = projection.plan;
  const activeActions = snapshot.plan_actions.filter(action => action.plan_id === currentPlan?.id && !projection.invalidActionIds.includes(action.id));
  const route = projection.route;
  const routeDestination = route ? snapshot.destinations.find(item => item.id === route.destination_id) : null;
  const mapSurface: ReactNode = projection.mapGate && view === 'dashboard' && route?.geometry
    ? <section className="verified-route-panel"><h2>{messages.map}</h2><p>{messages.mapLabel}</p>
      <EmergencyMap language={language} conserve={power.mode !== 'NORMAL'} profile={snapshot.profile} location={deviceLocation} route={route}
        routeDestination={routeDestination ? { id: routeDestination.id, name: routeDestination.name,
          lng: routeDestination.coordinates.lng, lat: routeDestination.coordinates.lat } : null} />
    </section> : undefined;
  const checkControls = <SafetyCheckControls check={check} setCheck={setCheck} messages={messages} />;
  return <>
    {urgent && view !== 'dashboard' && <section className="emergency-takeover" role="status"><strong>{projection.primaryAction?.text || messages.emergency}</strong>
      <p>{projection.presentation.mode === 'MAP_ASSISTED' ? messages.mapLabel : messages.emergencyDetail}</p><Link href="/dashboard">{messages.home} →</Link>
    </section>}
    {view === 'dashboard' && <>
      {snapshot.spatial_guidance.current_action_kind === 'EVACUATE' && !projection.mapGate && <p className="map-gate-notice" role="status">{messages.mapGateClosed}</p>}
      <AdaptiveHome presentation={projection.presentation} snapshot={snapshot} language={language}
        networkState={projection.networkState} planStatus={projection.planStatus} notifications={notifications.length} actions={activeActions}
        mapSurface={mapSurface} checkControls={checkControls} powerMode={power.mode} location={deviceLocation} mapClosed={false} />
    </>}
    {view === 'plan' && <section className="live-plan-scene"><h1>{messages.planReview}</h1>
      <div className="action-grid live-action-grid">{(['NOW', 'NEXT', 'AVOID'] as const).map(category => <section className="action-panel" key={category}>
        <small>{category}</small>{activeActions.filter(action => action.category === category).map(action => <article key={action.id}><h2>{action.text}</h2>
          <p>{action.reason}</p>{action.evidence_ids.map(id => <Link key={id} href="/sources">{language === 'ja' ? '根拠を確認' : language === 'zh-TW' ? '檢視依據' : 'Review evidence'} →</Link>)}</article>)}
        {!activeActions.some(action => action.category === category) && <p className="muted">{messages.noPlan}</p>}
      </section>)}</div>
      <p>{messages.lastVerified}: {displayTime(snapshot.situation.latest_evidence_at, language)}</p>
      {snapshot.plan_evaluations.findLast(item => item.plan_id === currentPlan?.id)?.reason && <p>{snapshot.plan_evaluations.findLast(item => item.plan_id === currentPlan?.id)?.reason}</p>}
      {urgent && <div className="emergency-contact"><h2>{messages.emergencyContacts}</h2><p>{messages.emergencyContactText}</p><a href="tel:119">119</a> · <a href="tel:110">110</a></div>}
    </section>}
    {view === 'notifications' && <NotificationsScene notifications={notifications} messages={messages} dismiss={dismissNotification} />}
    {view === 'sources' && <SourceReview snapshot={snapshot} language={language} messages={messages} projection={projection} />}
    {view === 'more' && <section className="live-more-scene"><h1>{messages.more}</h1>
      <section className="settings-panel"><h2>{messages.profile}</h2><ProfileForm language={language} busy={busy} submit={onProfile} initial={snapshot.profile}
        startLabel={messages.begin} title={messages.setup} copy={messages.profileUpdated} messages={messages} /></section>
      <section className="settings-panel"><h2>{messages.settings}</h2><label>{messages.appearance}<select value={theme} onChange={event => chooseTheme(event.target.value)}>
        <option value="dark">{adaptiveMessages[language].dark}</option><option value="system">{adaptiveMessages[language].system}</option><option value="contrast">{adaptiveMessages[language].contrast}</option>
      </select></label>
        <PowerControls language={language} power={power} level={level} override={override} choose={choose} />
        <DeviceLocationControls location={deviceLocation} language={language} />
      </section>
      <SafetyCheckControls check={check} setCheck={setCheck} messages={messages} />
      <RoutePreview snapshot={snapshot} projectedRoute={projection.route} language={language} messages={messages} busy={busy} connection={connection} now={now} location={deviceLocation} power={power} search={onRouteSearch} />
      <HandoffCard link={link} messages={messages} />
      <OfflineReadinessPanel messages={messages} />
      <PlanHistory snapshot={snapshot} projection={projection} language={language} messages={messages} now={now} />
      <section className="emergency-contact"><h2>{messages.emergencyGuide}</h2><p>{messages.builtInGuide}</p><a href="tel:119">119</a> · <a href="tel:110">110</a></section>
      <section className="settings-panel"><h2>{messages.source}</h2><p>{messages.attribution}</p>{!sessionLost && <button type="button" disabled={busy || connection === 'offline'} onClick={onRefresh}>{busy ? messages.refreshing : messages.retry}</button>}</section>
      <section className="settings-panel"><h2>{messages.judge}</h2><p>{messages.replay}</p><Link href="/demo">{messages.judge} →</Link></section>
    </section>}
    {view === 'more' && snapshot.spatial_guidance.current_action_kind === 'EVACUATE' && !projection.mapGate && <p className="muted">{messages.mapGateClosed}</p>}
    {view !== 'dashboard' && urgent && <section className="emergency-contact"><h2>{messages.emergencyContacts}</h2><p>{messages.emergencyContactText}</p><a href="tel:119">119</a> · <a href="tel:110">110</a></section>}
    <time className="sr-only" dateTime={new Date(now).toISOString()} />
  </>;
}

function DesktopPreparedness({ view, snapshot, language, messages, projection, link, busy, power, location, connection, now, refresh, onProfile,
  onRouteSearch, check, setCheck, notifications, dismissNotification, sessionLost }: {
  view: string; snapshot: LiveSnapshot | null; language: Language; messages: Record<string, string>;
  projection: ReturnType<typeof projectLiveSnapshot> | null; link: string | null; busy: boolean; power: ReturnType<typeof usePower>['power'];
  location: ReturnType<typeof useDeviceLocation>; connection: Connection; now: number; refresh: () => void; onProfile: (profile: LiveProfileSeed) => void;
  onRouteSearch: (origin: Location, destinationId: string) => Promise<boolean>; check: SafetyCheckState;
  setCheck: Dispatch<SetStateAction<SafetyCheckState>>; notifications: Notification[]; dismissNotification: (id: string) => void; sessionLost: boolean;
}) {
  const currentPlan = projection?.plan;
  const currentActions = snapshot?.plan_actions.filter(item => item.plan_id === currentPlan?.id && !projection?.invalidActionIds.includes(item.id)) ?? [];
  return <div className="desktop-preparedness">
    <header className="desktop-preparedness-heading"><div><p className="eyebrow">72H · {messages.preparedness}</p><h1>{messages.review}</h1></div>
      {snapshot && projection && <div className="desktop-status"><strong>{isPrimarySourceCurrent(snapshot, projection) ? messages.sourceFresh : messages.sourceStale}</strong><span>{displayTime(snapshot.situation.latest_evidence_at, language)}</span></div>}
    </header>
    <p className="desktop-role-note">{messages.roleNote}</p>
    {!snapshot || !projection ? <ProfileForm language={language} busy={busy} submit={onProfile} startLabel={messages.begin} title={messages.startTitle} copy={messages.startText} messages={messages} /> : <>
      <div className="desktop-overview-grid">
        <section className="desktop-overview-card"><small>{messages.monitor}</small><h2>{projection.primaryAction?.text || messages.pending}</h2>
          <p>{messages.lastVerified}: {displayTime(snapshot.situation.latest_evidence_at, language)}</p>
          {snapshot.spatial_guidance.current_action_kind === 'EVACUATE' && <p>{messages.mapGateClosed}</p>}
        </section>
        <section className="desktop-overview-card"><small>{messages.profile}</small><h2>{snapshot.profile.current_location.label}</h2>
          <p>→ {snapshot.profile.accommodation_location.label}</p><p>{snapshot.profile.party_size}</p>
        </section>
        <SourceSummary snapshot={snapshot} language={language} messages={messages} projection={projection} />
      </div>
      {(view === 'dashboard' || view === 'plan') && <section className="desktop-plan-review"><h2>{messages.planReview}</h2>
        {currentPlan ? <><p>{messages.planCreated}: {displayTime(currentPlan.created_at, language)} · {messages.planExpires}: {displayTime(currentPlan.expires_at, language)}</p>
        {currentActions.map(action => <article key={action.id}><strong>{messages[action.category] ?? action.category}</strong><h3>{action.text}</h3><p>{action.reason}</p></article>)}
        </> : <p>{messages.noPlan}</p>}
        <p>{messages.preparedness}</p>
      </section>}
      {view === 'sources' && <SourceReview snapshot={snapshot} language={language} messages={messages} projection={projection} />}
      {view === 'notifications' && <NotificationsScene notifications={notifications} messages={messages} dismiss={dismissNotification} />}
      {view === 'more' && <section className="desktop-settings"><h2>{messages.settings}</h2><ProfileForm language={language} busy={busy} submit={onProfile} initial={snapshot.profile}
        startLabel={messages.begin} title={messages.setup} copy={messages.profileUpdated} messages={messages} />
        <SafetyCheckControls check={check} setCheck={setCheck} messages={messages} />
        <RoutePreview snapshot={snapshot} projectedRoute={projection.route} language={language} messages={messages} busy={busy} connection={connection} now={now} location={location} power={power} search={onRouteSearch} />
        <HandoffCard link={link} messages={messages} />
        <OfflineReadinessPanel messages={messages} />
        <PlanHistory snapshot={snapshot} projection={projection} language={language} messages={messages} now={now} />
        <section className="emergency-contact"><h2>{messages.emergencyGuide}</h2><p>{messages.builtInGuide}</p><a href="tel:119">119</a> · <a href="tel:110">110</a></section>
        {!sessionLost && <button type="button" disabled={busy} onClick={refresh}>{busy ? messages.refreshing : messages.retry}</button>}
      </section>}
      {(view === 'dashboard' || view === 'plan') && <div className="desktop-readiness-grid">
        <OfflineReadinessPanel messages={messages} /><PlanHistory snapshot={snapshot} projection={projection} language={language} messages={messages} now={now} />
        <section className="emergency-contact"><h2>{messages.emergencyGuide}</h2><p>{messages.builtInGuide}</p><a href="tel:119">119</a> · <a href="tel:110">110</a></section>
      </div>}
    </>}
    <footer className="desktop-footer"><Link href="/demo">{messages.judge} / Demo →</Link></footer>
  </div>;
}

export function LiveDashboard({ view }: { view: string }) {
  const role = useDeviceRole();
  const [language, setLanguage] = useState<Language>('ja');
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>('reconnecting');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sessionLost, setSessionLost] = useState(false);
  const [now, setNow] = useState(0);
  const [link, setLink] = useState<string | null>(null);
  const [check, setCheck] = useState(initialSafetyCheck);
  const [checkRestored, setCheckRestored] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const snapshotRef = useRef<LiveSnapshot | null>(null);
  const connectionRef = useRef<Connection>('reconnecting');
  const reconnectAnchor = useRef<number | null>(null);
  const requestPending = useRef(false);
  const checkSession = useRef<string | null>(null);
  const notificationSession = useRef<string | null>(null);
  const notificationSeen = useRef(new Set<string>());
  const previousLive = useRef<LiveSnapshot | null>(null);
  const previousLiveConnection = useRef<Connection>('reconnecting');
  const previousSafetyCheck = useRef<SafetyCheckState | null>(null);
  const power = usePower();
  const { theme, chooseTheme } = useTheme();
  const deviceLocation = useDeviceLocation(connection === 'online');
  const messages = liveMessages[language];

  const setNetwork = useCallback((value: Connection) => { connectionRef.current = value; setConnection(value); }, []);
  const store = useCallback((state: LiveSnapshot) => {
    snapshotRef.current = state; setSnapshot(state);
    try { localStorage.setItem('72h-live-session', state.session_id); } catch { setError(messages.sourceUnavailable); }
    void saveLiveSnapshot(state, Date.now()).catch(() => setError(messages.sourceUnavailable));
  }, [messages.sourceUnavailable]);

  const refresh = useCallback(async (sessionId?: string) => {
    const id = sessionId ?? snapshotRef.current?.session_id ?? sessionRef();
    if (!id || sessionLost || requestPending.current || !navigator.onLine) return;
    requestPending.current = true; setBusy(true); setError('');
    const wasReconnecting = connectionRef.current === 'reconnecting';
    const anchor = reconnectAnchor.current;
    try {
      const received = await refreshLiveSession(id);
      const previous = snapshotRef.current;
      const receivedAt = Date.now();
      store(received);
      if (wasReconnecting) {
        const canRestore = anchor !== null && canReconcileLiveSnapshot(previous, received, anchor, receivedAt);
        if (canRestore) { reconnectAnchor.current = null; setNetwork('online'); }
        else setNetwork(navigator.onLine ? 'reconnecting' : 'offline');
      } else if (!navigator.onLine) setNetwork('offline');
      else if (received.source.status !== 'FRESH' || received.situation.network_state !== 'ONLINE_VERIFIED'
        || received.situation.conflict_flags.length > 0 || received.situation.claim_states.some(item => item.status === 'CONFLICT')) {
        reconnectAnchor.current ??= Date.now(); setNetwork('reconnecting');
      } else setNetwork('online');
      setNow(receivedAt);
    } catch (error) {
      if (isMissingLiveSessionError(error)) {
        setSessionLost(true); setError(''); setNetwork('reconnecting');
      } else setError(messages.sourceUnavailable);
      if (!navigator.onLine) setNetwork('offline');
      else if (!isMissingLiveSessionError(error)) {
        if (connectionRef.current !== 'reconnecting') reconnectAnchor.current = Date.now();
        setNetwork('reconnecting');
      }
    } finally { requestPending.current = false; setBusy(false); }
  }, [messages.sourceUnavailable, sessionLost, setNetwork, store]);

  const searchRoute = useCallback(async (origin: Location, destinationId: string): Promise<boolean> => {
    const id = snapshotRef.current?.session_id ?? sessionRef();
    if (!id || requestPending.current || !navigator.onLine || connectionRef.current === 'offline'
      || !power.power.allowNonCriticalNetwork) return false;
    requestPending.current = true; setBusy(true); setError('');
    try {
      const received = await searchLiveRoute(id, origin, destinationId);
      store(received); setNow(Date.now());
      return true;
    } catch (error) {
      if (isMissingLiveSessionError(error)) { setSessionLost(true); setError(''); setNetwork('reconnecting'); }
      else setError(messages.routeUnavailable);
      return false;
    } finally { requestPending.current = false; setBusy(false); }
  }, [messages.routeUnavailable, power.power.allowNonCriticalNetwork, setNetwork, store]);

  const begin = useCallback(async (profile: LiveProfileSeed) => {
    if (!navigator.onLine || !power.power.allowNonCriticalNetwork || requestPending.current) return;
    requestPending.current = true; setBusy(true); setError(''); setSessionLost(false); setNetwork('reconnecting');
    const requestStartedAt = Date.now();
    try {
      const received = await startLiveSession(language, profile);
      store(received);
      const verified = canReconcileLiveSnapshot(null, received, requestStartedAt, Date.now());
      setNetwork(verified ? 'online' : 'reconnecting');
      reconnectAnchor.current = verified ? null : requestStartedAt;
      setNow(Date.now());
    } catch {
      setError(messages.sourceUnavailable);
      setNetwork(navigator.onLine ? 'reconnecting' : 'offline');
      reconnectAnchor.current = requestStartedAt;
    } finally { requestPending.current = false; setBusy(false); }
  }, [language, messages.sourceUnavailable, power.power.allowNonCriticalNetwork, setNetwork, store]);

  useEffect(() => {
    try {
      const preferred = localStorage.getItem('72h-language');
      const requested = new URLSearchParams(window.location.search).get('language');
      const candidate = requested || preferred;
      if (candidate && ['ja', 'en', 'zh-TW'].includes(candidate)) setLanguage(candidate as Language);
    } catch { /* The UI remains usable without local preferences. */ }
    let cancelled = false;
    void (async () => {
      const saved = await loadLiveSnapshot().catch(() => null);
      if (cancelled) return;
      if (saved) {
        snapshotRef.current = saved.snapshot; setSnapshot(saved.snapshot);
      }
      if (!navigator.onLine) { setNetwork('offline'); return; }
      const session = saved?.snapshot.session_id ?? sessionRef();
      if (session) {
        reconnectAnchor.current = Date.now();
        setNetwork('reconnecting');
        void refresh(session);
      } else setNetwork('online');
    })();
    const offline = () => { reconnectAnchor.current = null; setNetwork('offline'); };
    const online = () => {
      if (!snapshotRef.current && !sessionRef()) { setNetwork('online'); return; }
      reconnectAnchor.current = Date.now(); setNetwork('reconnecting'); void refresh();
    };
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => setError(messages.sourceUnavailable));
    return () => { cancelled = true; window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
    // Restore once. A cached session stays in RECONNECTING until typed source reconciliation succeeds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const origin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    setLink(publicHandoffUrl(origin, language));
  }, [language]);

  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => { setNow(Date.now()); }, []);
  useEffect(() => {
    if (!snapshot || sessionLost || connection === 'offline' || !power.power.allowNonCriticalNetwork) return;
    const suggested = Date.parse(snapshot.source.next_retry_at ?? '');
    const delay = Math.max(power.power.refreshMs, Number.isFinite(suggested) && suggested > Date.now() ? suggested - Date.now() : 60_000);
    const timer = setTimeout(() => void refresh(snapshot.session_id), delay);
    return () => clearTimeout(timer);
  }, [snapshot, sessionLost, connection, power.power.allowNonCriticalNetwork, power.power.refreshMs, refresh]);
  useEffect(() => {
    if (!snapshot || !now) return;
    const deadline = nextLiveSafetyDeadline(snapshot, now);
    if (!deadline) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, deadline - now));
    return () => clearTimeout(timer);
  }, [snapshot, now]);

  useEffect(() => {
    const sessionId = snapshot?.session_id;
    if (!sessionId || checkSession.current === sessionId) return;
    checkSession.current = sessionId; setCheckRestored(false);
    let restored = initialSafetyCheck();
    try {
      const raw = localStorage.getItem(`72h-live-safety-check:${sessionId}`);
      if (raw) {
        const parsed = safetyCheckSchema.safeParse(JSON.parse(raw));
        if (parsed.success && (!parsed.data.eventKey || parsed.data.eventKey.startsWith(`${sessionId}:`))) restored = parsed.data;
      }
    } catch { setError(messages.sourceUnavailable); }
    setCheck(restored); setCheckRestored(true);
  }, [snapshot?.session_id, messages.sourceUnavailable]);
  useEffect(() => {
    if (!checkRestored || !snapshot) return;
    try { localStorage.setItem(`72h-live-safety-check:${snapshot.session_id}`, JSON.stringify(safetyCheckSchema.parse(check))); }
    catch { setError(messages.sourceUnavailable); }
  }, [check, checkRestored, messages.sourceUnavailable, snapshot]);

  const reducerState = useMemo(() => snapshot ? reducerSnapshot(snapshot) : null, [snapshot]);
  const severity = useMemo(() => reducerState && now > 0 ? deriveSeverity(reducerState, now) : null, [reducerState, now]);
  const criticalEligible = !!snapshot && !!severity?.criticalEventKey && severity.level === 'L4'
    && connection === 'online' && snapshot.source.status === 'FRESH'
    && snapshot.situation.network_state === 'ONLINE_VERIFIED'
    && snapshot.situation.conflict_flags.length === 0
    && !snapshot.situation.claim_states.some(item => item.status === 'CONFLICT');
  const checkActive = !!snapshot && check.consent && !!check.eventKey
    && check.eventKey.startsWith(`${snapshot.session_id}:`)
    && ['AWAITING_RESPONSE', 'UNRESPONSIVE_UNKNOWN', 'NEEDS_ASSISTANCE', 'CANNOT_MOVE'].includes(check.status);
  useEffect(() => {
    if (!checkRestored || !snapshot || !now) return;
    const eventKey = `${snapshot.session_id}:${severity?.criticalEventKey ?? 'none'}`;
    setCheck(state => reduceSafetyCheck(state, { type: 'CRITICAL', eventKey, eligible: criticalEligible, now }));
  }, [checkRestored, criticalEligible, now, severity?.criticalEventKey, snapshot?.session_id]);
  useEffect(() => {
    if (!checkActive || check.status !== 'AWAITING_RESPONSE') return;
    const timer = setInterval(() => setCheck(state => reduceSafetyCheck(state, { type: 'TICK', now: Date.now() })), 1000);
    return () => clearInterval(timer);
  }, [checkActive, check.status]);

  useEffect(() => {
    const sessionId = snapshot?.session_id;
    if (!sessionId || notificationSession.current === sessionId) return;
    notificationSession.current = sessionId; previousLive.current = null; previousSafetyCheck.current = null;
    previousLiveConnection.current = connection; notificationSeen.current = new Set(); setNotifications([]);
    try {
      const raw = localStorage.getItem('72h-live-notification-ledger');
      if (raw) {
        const parsed = notificationLedgerSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.session === sessionId) {
          notificationSeen.current = new Set(parsed.data.seen);
          setNotifications(aggregateNotifications([], parsed.data.items as Notification[]));
        }
      }
    } catch { setError(messages.sourceUnavailable); }
  }, [connection, messages.sourceUnavailable, snapshot?.session_id]);
  useEffect(() => {
    if (!snapshot || !now) return;
    const before = previousLive.current;
    const beforeReducer = before ? reducerSnapshot(before) : null;
    const incoming = beforeReducer && reducerState
      ? deriveNotifications(beforeReducer, reducerState, now, connection, previousLiveConnection.current) : [];
    const routeEvent = before ? liveRouteNotification(before, snapshot, now) : null;
    if (routeEvent) incoming.push(routeEvent);
    if (check.status === 'AWAITING_RESPONSE' && previousSafetyCheck.current?.status !== 'AWAITING_RESPONSE' && check.eventKey) {
      incoming.push({ id: `safety_check_required:${encodeURIComponent(check.eventKey)}`, event: 'SAFETY_CHECK_REQUIRED',
        kind: 'SAFETY_CHECK', evidenceIds: [], href: '/dashboard' });
    }
    previousLive.current = snapshot; previousLiveConnection.current = connection; previousSafetyCheck.current = check;
    const unseen = incoming.filter(item => !notificationSeen.current.has(item.id));
    for (const item of unseen) notificationSeen.current.add(item.id);
    if (unseen.length) setNotifications(items => aggregateNotifications(items, unseen));
    if (notificationSeen.current.size > 512) notificationSeen.current = new Set([...notificationSeen.current].slice(-512));
  }, [check, connection, now, reducerState, snapshot]);
  useEffect(() => {
    if (!snapshot || notificationSession.current !== snapshot.session_id) return;
    try { localStorage.setItem('72h-live-notification-ledger', JSON.stringify({ session: snapshot.session_id,
      seen: [...notificationSeen.current], items: notifications })); }
    catch { setError(messages.sourceUnavailable); }
  }, [messages.sourceUnavailable, notifications, snapshot]);
  const projection = useMemo(() => snapshot ? projectLiveSnapshot(snapshot, now, connection, power.power, notifications.length, checkActive) : null,
    [snapshot, now, connection, power.power, notifications.length, checkActive]);
  const networkLabel = connection === 'offline' ? messages.offline
    : connection === 'reconnecting' || projection?.networkState === 'RECONNECTING' ? messages.reconnecting
      : projection?.networkState === 'ONLINE_VERIFIED' && snapshot && isPrimarySourceCurrent(snapshot, projection) ? messages.sourceFresh : messages.sourceStale;
  const criticalMobileTakeover = shouldUseCriticalMobileTakeover(role, projection?.presentation.mode);
  const mobileView = criticalMobileTakeover ? 'dashboard' : view;
  const nav = [
    { key: 'dashboard', label: messages.home, icon: '⌂' },
    { key: 'plan', label: messages.plan, icon: '▤' },
    { key: 'more', label: messages.more, icon: '···' },
  ];
  const desktopNav = [
    { key: 'dashboard', label: messages.home }, { key: 'plan', label: messages.plan },
    { key: 'sources', label: messages.source }, { key: 'notifications', label: messages.notifications },
    { key: 'more', label: messages.more },
  ];
  const mainContent = role === 'unknown' ? <div className="device-role-pending" role="status">{messages.loading}</div>
    : role === 'desktop'
      ? <DesktopPreparedness view={view} snapshot={snapshot} language={language} messages={messages} projection={projection}
        link={link} busy={busy} power={power.power} location={deviceLocation} connection={connection} now={now}
        refresh={() => void refresh()} onProfile={profile => void begin(profile)} onRouteSearch={searchRoute}
        check={check} setCheck={setCheck} notifications={notifications} dismissNotification={id => setNotifications(items => items.filter(item => item.id !== id))} sessionLost={sessionLost} />
      : <MobileScene view={mobileView} snapshot={snapshot} language={language} messages={messages} projection={projection}
        deviceLocation={deviceLocation} power={power.power} level={power.level} override={power.override} choose={power.choose}
        theme={theme} chooseTheme={chooseTheme} busy={busy} onProfile={profile => void begin(profile)} onRefresh={() => void refresh()}
        onRouteSearch={searchRoute} link={link} now={now} connection={connection} check={check} setCheck={setCheck}
        notifications={notifications} dismissNotification={id => setNotifications(items => items.filter(item => item.id !== id))} sessionLost={sessionLost} />;

  return <div className={`live-shell theme-${theme} power-${power.power.mode.toLowerCase()} role-${role}`}>
    {!criticalMobileTakeover && <header className="live-topbar"><Link className="live-brand" href="/dashboard">72<span>H</span></Link>
      <div className="live-topbar-state"><strong>{messages.monitor}</strong><span>{networkLabel}</span></div>
      {role === 'desktop' && <nav className="desktop-primary-nav" aria-label={messages.preparedness}>{desktopNav.map(item => <Link key={item.key} href={`/${item.key}`} aria-current={view === item.key ? 'page' : undefined}>{item.label}</Link>)}</nav>}
      <label className="live-language">{messages.language}<select aria-label={messages.language} value={language} onChange={event => {
        const next = event.target.value as Language; setLanguage(next); try { localStorage.setItem('72h-language', next); } catch { /* In-memory fallback. */ }
      }}><option value="ja">日本語</option><option value="en">English</option><option value="zh-TW">繁體中文</option></select></label>
    </header>}
    <main className="live-main">
      {error && <p className="error" role="alert">{error}</p>}
      {sessionLost && snapshot && !criticalMobileTakeover && <section className="session-loss-banner" role="status">
        <strong>{messages.sessionLost}</strong><p>{messages.lastVerified}: {displayTime(snapshot.situation.latest_evidence_at, language)}</p>
        <Link href="/more">{messages.startNewSession} →</Link>
      </section>}
      {mainContent}
      {role === 'mobile' && !criticalMobileTakeover && <nav className="mobile-primary-nav" aria-label={language === 'ja' ? 'メイン' : language === 'zh-TW' ? '主選單' : 'Main navigation'}>
        {nav.map(item => <Link key={item.key} href={`/${item.key}`} aria-current={view === item.key ? 'page' : undefined} className={view === item.key ? 'selected' : ''}>
          <span aria-hidden="true">{item.icon}</span><small>{item.label}</small>
        </Link>)}
      </nav>}
      {role === 'desktop' && snapshot && <div className="desktop-handoff-link"><Link href="/more">{messages.handoff} →</Link></div>}
    </main>
  </div>;
}
