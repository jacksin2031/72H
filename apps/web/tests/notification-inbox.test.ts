import { expect, it } from 'vitest';
import { aggregateNotifications, notificationLedgerSchema } from '../lib/notification-inbox';
import type { Notification } from '../lib/vnext';

it('aggregates repeated plan updates but preserves distinct critical incidents', () => {
  const update = (id: string): Notification => ({ id, event: 'PLAN_SUPERSEDED', kind: 'INFO', evidenceIds: [], href: '/plan' });
  const critical = (id: string): Notification => ({ id, event: 'CRITICAL_WARNING', kind: 'CRITICAL', evidenceIds: [], href: '/dashboard' });
  expect(aggregateNotifications([update('v2'), critical('incident1')], [update('v3'), critical('incident2')]).map(n => n.id)).toEqual(['v3', 'incident2', 'incident1']);
  expect(aggregateNotifications([critical('incident1')], [critical('incident1')])).toHaveLength(1);
});

it('restores a bounded inbox and rejects unsafe navigation or unbounded content', () => {
  const base = { session: 'session', seen: ['n'], items: [{ id: 'n', event: 'NETWORK_LOST', kind: 'ATTENTION', evidenceIds: [], href: '/dashboard' }] };
  expect(notificationLedgerSchema.parse(base).items).toHaveLength(1);
  expect(notificationLedgerSchema.safeParse({ ...base, seen: Array(513).fill('n') }).success).toBe(false);
  expect(notificationLedgerSchema.safeParse({ ...base, items: [{ ...base.items[0], href: 'javascript:alert(1)' }] }).success).toBe(false);
});

it('caps aggregated notifications at twelve and keeps the newest distinct incidents first', () => {
  const incoming: Notification[] = Array.from({ length: 15 }, (_, index) => ({
    id: `incident-${index + 1}`, event: 'CRITICAL_WARNING', kind: 'CRITICAL', evidenceIds: [], href: '/dashboard',
  }));
  const result = aggregateNotifications([], incoming);
  expect(result).toHaveLength(12);
  expect(result.map(item => item.id)).toEqual(incoming.slice(0, 12).map(item => item.id));
});
