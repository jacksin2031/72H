// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { OfficialSourceReview, referenceLifecycle } from '../components/official-source-review';
import { officialRecoverySchema, officialReportSchema, liveSourceSchema, liveSnapshotSchema } from '../lib/contracts';
import { movementLiveSnapshot, LIVE_NOW } from './live-fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, container: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); root = null; container = null; });
const at = (offset: number) => new Date(LIVE_NOW + offset).toISOString();
const report = officialReportSchema.parse({
  report_id: `${'a'.repeat(24)}--${'b'.repeat(24)}`, group_id: 'a'.repeat(24), raw_sha256: 'b'.repeat(64),
  product: 'VTSE41', title: '津波警報・注意報・予報', source_name: 'JMA test fixture',
  reference_url: 'https://www.data.jma.go.jp/developer/xml/data/test-only.xml', event_ids: ['20261006010000'], serial: null,
  operation: 'ISSUE', lifecycle: 'CURRENT', issued_at: at(-30_000), reported_at: at(-35_000), received_at: at(-20_000),
  target_at: null, occurred_at: null, official_valid_until: null, evidence_expires_at: at(870_000),
  target_codes: ['210'], is_head: true, superseded_by: null, parser_version: 'test-v1', information_version: '1.0_1',
  code_mapping_version: 'test-v1', authority: 'REFERENCE_ONLY', eligible_for_action: false,
});
const recovery = officialRecoverySchema.parse({
  persistence: 'SQLITE', storage_status: 'HEALTHY', scan_status: 'WINDOW_VERIFIED', connection_status: 'REACHABLE',
  last_successful_fetch_at: at(-10_000), pending_details: 0, archived_reports: 1, checkpoint_version: 1,
  last_checked_at: at(-10_000), last_verified_at: at(-60_000), window_start_at: at(-600_000), coverage_origin_at: at(-600_000),
  restored: true, limitations: ['Reference only.'],
});

it('rejects false recovery completion and action authority at the contract boundary', () => {
  expect(officialRecoverySchema.safeParse({ ...recovery, pending_details: 1 }).success).toBe(false);
  expect(officialRecoverySchema.safeParse({ ...recovery, reconciliation_required_since: at(-10_000) }).success).toBe(false);
  expect(liveSourceSchema.safeParse({ ...movementLiveSnapshot().source, recovery: { ...recovery, scan_status: 'SCANNING' } }).success).toBe(false);
  expect(officialReportSchema.safeParse({ ...report, eligible_for_action: true }).success).toBe(false);
  expect(officialReportSchema.safeParse({ ...report, reference_url: 'https://attacker.example/test.xml' }).success).toBe(false);
  const snapshot = movementLiveSnapshot();
  snapshot.official_sources = [{ ...snapshot.source, status: 'INVALID_RESPONSE', recovery: { ...recovery, scan_status: 'SCANNING' } }];
  expect(liveSnapshotSchema.safeParse(snapshot).success).toBe(false);
});

it('expires locally at the exact deadline, marks offline and future-clock records unknown, and retains withdrawn history', () => {
  expect(referenceLifecycle(report, LIVE_NOW, true)).toBe('CURRENT');
  expect(referenceLifecycle(report, LIVE_NOW + 870_000, true)).toBe('STALE');
  expect(referenceLifecycle(report, LIVE_NOW, false)).toBe('UNKNOWN');
  expect(referenceLifecycle(report, LIVE_NOW - 60_000, true)).toBe('UNKNOWN');
  expect(referenceLifecycle({ ...report, lifecycle: 'WITHDRAWN', operation: 'CANCEL' }, LIVE_NOW, false)).toBe('WITHDRAWN');
});

it.each(['zh-TW', 'ja', 'en'] as const)('renders separate clocks, scope and storage in %s without movement controls', async language => {
  const snapshot = movementLiveSnapshot();
  snapshot.official_reports = [{ ...report, operation: 'CANCEL', lifecycle: 'WITHDRAWN' }];
  snapshot.official_sources = [{ ...snapshot.source, recovery }];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<OfficialSourceReview snapshot={snapshot} language={language} now={LIVE_NOW} connected={false} />));
  expect(container.querySelectorAll('dt').length).toBe(14);
  expect(container.textContent).toContain('SQLITE');
  expect(container.textContent).toContain('210');
  expect(container.querySelector('a')!.getAttribute('href')).toBe(report.reference_url);
  expect(container.querySelector('button')).toBeNull();
  const text = container.textContent!;
  if (language === 'zh-TW') {
    expect(text).toContain('電文已撤銷；不代表地區警報解除');
    expect(text).toContain('應用程式證據使用期限');
    expect(text).toContain('官方有效期未判定');
    expect(text).toContain('當前狀態未核實');
  }
});
