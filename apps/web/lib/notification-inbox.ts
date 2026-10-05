import { z } from 'zod';
import type { Notification } from './vnext';

export const notificationSchema = z.object({
  id: z.string().max(1000), event: z.enum(['PLAN_INVALIDATED', 'PLAN_SUPERSEDED', 'ROUTE_DEPENDENCY_CHANGED', 'EVIDENCE_EXPIRED', 'NETWORK_LOST', 'NETWORK_RESTORED', 'VERIFICATION_RESTORED', 'CRITICAL_WARNING', 'SAFETY_CHECK_REQUIRED']),
  kind: z.enum(['INFO', 'ATTENTION', 'IMPORTANT', 'CRITICAL', 'SAFETY_CHECK']),
  evidenceIds: z.array(z.string().max(160)).max(200), href: z.enum(['/dashboard', '/plan', '/sources', '/more']),
});
export const notificationLedgerSchema = z.object({ session: z.string().max(160), seen: z.array(z.string().max(1000)).max(512), items: z.array(notificationSchema).max(12).default([]) });

/** Keep latest actionable update of each event class; distinct critical incidents stay distinct. */
export function aggregateNotifications(existing: Notification[], incoming: Notification[]): Notification[] {
  const keys = new Set<string>();
  return [...incoming, ...existing].filter(item => {
    const key = item.kind === 'CRITICAL' || item.kind === 'SAFETY_CHECK' ? item.id : item.event;
    if (keys.has(key)) return false;
    keys.add(key); return true;
  }).slice(0, 12);
}
