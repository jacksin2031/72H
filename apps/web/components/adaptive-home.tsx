'use client';
import Link from 'next/link';
import { UiIcon } from './ui-icon';
import React, { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Action, Language, LiveSnapshot, Snapshot } from '../lib/contracts';
import type { PresentationProjection } from '../lib/adaptive-ui';
import type { DeviceLocation } from '../lib/use-device-location';
import { adaptiveMessages } from '../lib/adaptive-i18n';
import { vnextMessages } from '../lib/vnext-i18n';
import { projectLocationPresentation } from '../lib/location-presentation';

export function AdaptiveHome({ presentation, snapshot, language, networkState, planStatus, notifications,
  actions, mapSurface, checkControls, powerMode, location, mapClosed, now = Date.now() }: {
  presentation: PresentationProjection; snapshot: Snapshot | LiveSnapshot; language: Language; networkState: string;
  planStatus: string; notifications: number; actions: Action[]; mapSurface?: ReactNode; checkControls?: ReactNode;
  powerMode: string; location: DeviceLocation; mapClosed: boolean; now?: number;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const urgentModeRef = useRef(false);
  const t = adaptiveMessages[language];
  const vt = vnextMessages[language];
  const offline = networkState !== 'ONLINE_VERIFIED';
  const stale = networkState === 'OFFLINE_STALE' || planStatus === 'EXPIRED' || presentation.reasonCodes.includes('NOW_EVIDENCE_NOT_CURRENT');
  const stamp = snapshot.situation.latest_evidence_at;
  const verifiedTime = stamp ? new Date(stamp).toLocaleString(language, { timeZone: 'Asia/Tokyo' }) : '—';
  const mode = presentation.mode;
  const survival = mode === 'SURVIVAL';
  const restricted = survival || powerMode === 'EMERGENCY_POWER';
  const urgentMode = restricted || ['SAFETY_CHECK', 'EMERGENCY_PROTECT'].includes(mode);
  const locationPresentation = projectLocationPresentation(snapshot.profile.current_location, location, now);
  const areaSource = locationPresentation.area.source === 'GPS' ? t.areaSourceGps
    : locationPresentation.area.source === 'USER_SELECTED' ? t.areaSourceSelected : t.areaSourceUnknown;
  const areaFreshness = locationPresentation.area.freshness === 'CURRENT' ? t.locationFreshCurrent
    : locationPresentation.area.freshness === 'AGING' ? t.locationFreshAging
      : locationPresentation.area.freshness === 'STALE' ? t.locationFreshStale : t.locationFreshUnknown;
  urgentModeRef.current = urgentMode;
  const action = presentation.primaryAction;
  const destinationLabel = 'spatial_guidance' in snapshot
    ? snapshot.spatial_guidance.destination
      ? snapshot.destinations.find(item => item.id === snapshot.spatial_guidance.destination?.destination_id)?.name ?? vt.unknown
      : vt.unknown
    : snapshot.profile.current_destination?.label ?? vt.unknown;
  useEffect(() => { if (urgentMode) setDetailsOpen(false); }, [urgentMode]);
  useEffect(() => {
    if (!detailsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const dialog = document.querySelector<HTMLElement>('.plan-sheet[role="dialog"]');
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDetailsOpen(false); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      if (!urgentModeRef.current && detailsTrigger.current?.isConnected) detailsTrigger.current.focus();
    };
  }, [detailsOpen]);
  const evidenceLinks = (ids: string[]) => ids.map(id => {
    const e = snapshot.evidence.find(item => item.id === id);
    return <Link key={id} href="/sources">{e?.source_name ?? vt.unknown}</Link>;
  });
  return <section className={`adaptive-home presentation-${mode.toLowerCase()}`} data-presentation-mode={mode}>

    <header className="situation-header">
      <div><h1>{mode === 'EMERGENCY_PROTECT' ? t.protect : mode === 'SAFETY_CHECK' ? vt.check : survival ? t.survival : mode === 'MAP_ASSISTED' ? t.movement : mode === 'TEXT_WITH_DETAILS' ? t.prepare : t.monitoring}</h1>
        {!offline && !stale && <p>{mode === 'MAP_ASSISTED' ? t.movementDetail : t.summary}</p>}</div>
      {!urgentMode && <Link className="notification-badge" href="/notifications" aria-label={`${t.notifications} · ${notifications}`}><UiIcon name="bell" />{presentation.showNotificationsBadge && <span>{notifications}</span>}</Link>}
    </header>
    {(offline || stale) && <p className="freshness-warning" role="status">{t.lastVerified}: {verifiedTime} · {stale ? t.stale : t.cached}</p>}
    <section className="now-card" aria-labelledby="primary-now"><small id="primary-now">NOW</small><h2>{action?.text || t.pending}</h2></section>
    {!urgentMode && <details className="home-location-provenance" aria-label={t.currentPlace}>
      <summary><strong>{locationPresentation.area.label}</strong><span>{areaSource} · {areaFreshness}</span></summary>
      <div className="home-location-details">
        <p>{t.locationCheckedAt}: {locationPresentation.area.observedAt
          ? new Date(locationPresentation.area.observedAt).toLocaleString(language, { timeZone: 'Asia/Tokyo' }) : '—'}</p>
        {locationPresentation.area.accuracyM !== null && <p>{t.locationAccuracy}: ±{Math.round(locationPresentation.area.accuracyM)} m</p>}
        {locationPresentation.devicePoint && (locationPresentation.devicePoint.source === 'LAST_KNOWN'
          || locationPresentation.devicePoint.observedAt !== locationPresentation.area.observedAt) && <small>
            {locationPresentation.devicePoint.source === 'GPS' ? t.deviceGps : t.deviceLastKnown} · {new Date(locationPresentation.devicePoint.observedAt).toLocaleString(language, { timeZone: 'Asia/Tokyo' })}
            {' · '}{t.locationAccuracy}: ±{Math.round(locationPresentation.devicePoint.accuracyM)} m
          </small>}
      </div>
    </details>}
    {presentation.showEvidenceInline && action && <p className="inline-evidence">{evidenceLinks(action.evidence_ids)}</p>}
    {presentation.showSafetyCheck && checkControls}
    {presentation.showPowerWarning && <p className="power-warning" role="status"><UiIcon name="warning" />{powerMode === 'SURVIVAL' ? t.survival : powerMode === 'EMERGENCY_POWER' ? t.emergencyPower : t.conserve} {!urgentMode && <>· <Link href="/more">{t.power}</Link></>}</p>}
    {presentation.showMap && <>
      {presentation.showDestination && <p>{t.destination}: {destinationLabel}</p>}
      {presentation.showRoute && <p className="route-state" role="status">{presentation.routeText === 'BLOCKED' ? t.routeBlocked : presentation.routeText === 'UNKNOWN' ? t.routeUnknown : presentation.routeText === 'VERIFIED_USABLE_CANDIDATE' ? t.routeUsable : t.routeCandidate}</p>}
      {mapSurface}
    </>}
    {mapClosed && !presentation.showMap && <p role="status" className="muted">{t.mapEnded}</p>}
    {survival && <><p>{t.lastVerified}: {verifiedTime}</p><p>{t.position}: {location.position ? `${vt.locationStates[location.state]} · ${new Date(location.position.captured_at).toLocaleString(language, { timeZone: 'Asia/Tokyo' })}` : t.noPosition}</p></>}
    {(survival || mode === 'SAFETY_CHECK' || mode === 'EMERGENCY_PROTECT') && <section className="emergency-contact"><h2>{t.emergency}</h2><p>{t.emergencyDetail}</p><a href="tel:119">119</a> · <a href="tel:110">110</a></section>}
    {!urgentMode && <details className="home-emergency-basics"><summary>{t.emergencyBasics}</summary><p>{t.emergencyDetail}</p><p><a href="tel:119">119</a> · <a href="tel:110">110</a></p></details>}
    {!urgentMode && <button ref={detailsTrigger} type="button" className="plan-sheet-trigger" onClick={() => setDetailsOpen(true)}>{t.details}</button>}
    {!urgentMode && detailsOpen && <div className="plan-sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetailsOpen(false); }}>
      <section className="plan-sheet" role="dialog" aria-modal="true" aria-labelledby="plan-sheet-title" tabIndex={-1}>
        <header><h2 id="plan-sheet-title">{t.details}</h2><button ref={closeButton} type="button" onClick={() => setDetailsOpen(false)} aria-label={t.closeDetails}><UiIcon name="close" /></button></header>
        {action && <><p>{action.reason}</p>{evidenceLinks(action.evidence_ids)}</>}
        {(['NEXT', 'AVOID'] as const).map(category => <section key={category}><h2>{category}</h2>{actions.filter(item => item.category === category).map(item => <article key={item.id}><h3>{item.text}</h3><p>{item.reason}</p>{evidenceLinks(item.evidence_ids)}</article>)}</section>)}
        <p>{t.lastVerified}: {verifiedTime}</p>
        <Link href="/plan" onClick={() => setDetailsOpen(false)}>{vt.savedPlan}</Link>
      </section>
    </div>}
    {survival && <Link className="essential-settings" href="/more">{t.settings}</Link>}
  </section>;
}
