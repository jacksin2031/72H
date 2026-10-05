import { expect, it } from 'vitest';
import { deriveNotifications } from '../lib/vnext';
import { activeSnapshot } from './fixtures';

it('restores verification after a physical outage and staged refresh despite unchanged server network fields', () => {
  const anchor = activeSnapshot();
  const interim = structuredClone(anchor);
  interim.evidence.push({ ...anchor.evidence[0], id: 'new-official', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL', claim_type: 'DISASTER_STATUS', claims: [{ key: 'disaster.tokyo.status', value: 'ACTIVE' }] });
  const final = structuredClone(interim);
  final.evidence.push({ ...anchor.evidence[0], id: 'new-partner', relevant_areas: ['Shibuya'] });
  const now = Date.parse(final.replay.current_time);
  expect(deriveNotifications(anchor, interim, now, 'reconnecting', 'offline', anchor).some(n => n.event === 'VERIFICATION_RESTORED')).toBe(false);
  const result = deriveNotifications(interim, final, now, 'online', 'reconnecting', anchor);
  expect(result.find(n => n.event === 'VERIFICATION_RESTORED')?.evidenceIds).toEqual(['new-official', 'new-partner']);
  expect(deriveNotifications(interim, final, now, 'online', 'online', anchor).some(n => n.event === 'VERIFICATION_RESTORED')).toBe(false);
  expect(deriveNotifications(interim, final, now + 900_000, 'online', 'reconnecting', anchor).some(n => n.event === 'VERIFICATION_RESTORED')).toBe(false);
});

it('requires new evidence after the latest outage rather than evidence from an earlier recovery', () => {
  const firstAnchor = activeSnapshot();
  const recovered = structuredClone(firstAnchor);
  recovered.evidence.push({ ...firstAnchor.evidence[0], id: 'first-recovery-official', source_class: 'OFFICIAL', trust_status: 'VERIFIED_OFFICIAL', claim_type: 'DISASTER_STATUS', claims: [{ key: 'disaster.tokyo.status', value: 'ACTIVE' }] });
  recovered.evidence.push({ ...firstAnchor.evidence[0], id: 'first-recovery-partner', relevant_areas: ['Shibuya'] });
  const secondAnchor = structuredClone(recovered);
  const now = Date.parse(recovered.replay.current_time);
  expect(deriveNotifications(secondAnchor, recovered, now, 'online', 'reconnecting', secondAnchor).some(n => n.event === 'VERIFICATION_RESTORED')).toBe(false);
  const officialOnly = structuredClone(recovered);
  officialOnly.evidence.push({ ...recovered.evidence.at(-2)!, id: 'second-recovery-official' });
  expect(deriveNotifications(recovered, officialOnly, now, 'online', 'reconnecting', secondAnchor).some(n => n.event === 'VERIFICATION_RESTORED')).toBe(false);
  const final = structuredClone(officialOnly);
  final.evidence.push({ ...recovered.evidence.at(-1)!, id: 'second-recovery-partner' });
  expect(deriveNotifications(officialOnly, final, now, 'online', 'reconnecting', secondAnchor).find(n => n.event === 'VERIFICATION_RESTORED')?.evidenceIds).toEqual(['second-recovery-official', 'second-recovery-partner']);
});
