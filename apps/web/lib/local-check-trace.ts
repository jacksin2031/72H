import { z } from 'zod';
import type { SafetyCheckState } from './vnext';

export const localCheckTraceSchema = z.array(z.object({
  id: z.string().max(160), timestamp: z.iso.datetime({ offset: true }),
  agent: z.literal('LIFE_PROTECTION_ENGINE'), event_type: z.enum(['CONSENT_CHANGED', 'SAFETY_CHECK_STATE_CHANGED']),
  status: z.string().max(80), event_ref: z.string().max(512).nullable(), attempts: z.number().int().min(0).max(3),
})).max(128);
export type LocalCheckTrace = z.infer<typeof localCheckTraceSchema>;
export function checkTrace(previous: SafetyCheckState, next: SafetyCheckState, now: number): LocalCheckTrace[number] | null {
  if (previous.consent === next.consent && previous.status === next.status && previous.eventKey === next.eventKey && previous.attempts === next.attempts) return null;
  return { id: `local-check-${now}-${next.status}-${next.attempts}`, timestamp: new Date(now).toISOString(), agent: 'LIFE_PROTECTION_ENGINE', event_type: previous.consent !== next.consent ? 'CONSENT_CHANGED' : 'SAFETY_CHECK_STATE_CHANGED', status: next.status, event_ref: next.eventKey, attempts: next.attempts };
}
