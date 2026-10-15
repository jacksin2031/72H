import { z } from 'zod';
import { liveSnapshotSchema, type LiveSnapshot } from './contracts';

/**
 * A Mock Live envelope MUST remain synthetic. To reuse the complete official
 * Live cross-field validator, validate an ephemeral structural copy with
 * trusted-only discriminators first, then return ORIGINAL synthetic data.
 * The substitute values are never rendered, stored, sent or returned.
 * Ordinary liveSnapshotSchema is not modified or weakened.
 */
type MockLiveEvent = Omit<LiveSnapshot['events'][number], 'is_synthetic'> & { is_synthetic: true };
type MockEvidence = Omit<LiveSnapshot['evidence'][number], 'is_synthetic'> & { is_synthetic: true };
export type MockLiveSnapshot = Omit<LiveSnapshot, 'events' | 'evidence'> & {
  events: MockLiveEvent[];
  evidence: MockEvidence[];
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function parseMockLiveSnapshot(input: unknown): MockLiveSnapshot {
  if (!isRecord(input) || input.mode !== 'LIVE') throw new Error('Mock payload must contain a nested LiveSnapshot');
  const sources = ['source', 'destination_source', 'route_source'] as const;
  for (const kind of sources) {
    const source = input[kind];
    if (!isRecord(source) || typeof source.source_url !== 'string' ||
        !source.source_url.startsWith('mock://72h/') ||
        typeof source.source_name !== 'string' || !source.source_name.startsWith('SIMULATED')) {
      throw new Error('Mock source must be explicitly synthetic with mock://72h/ provenance');
    }
  }
  const officialSources = input.official_sources ?? [];
  if (!Array.isArray(officialSources) || officialSources.some(source => !isRecord(source) || typeof source.source_url !== 'string'
      || !source.source_url.startsWith('mock://72h/') || typeof source.source_name !== 'string' || !source.source_name.startsWith('SIMULATED'))) {
    throw new Error('Mock official sources must be explicitly synthetic with mock://72h/ provenance');
  }
  if (!Array.isArray(input.events) || input.events.some(item => !isRecord(item) || item.is_synthetic !== true) ||
      !Array.isArray(input.evidence) || input.evidence.some(item => !isRecord(item) ||
        item.is_synthetic !== true || item.eligible_for_high_risk !== false)) {
    throw new Error('Mock events and evidence must remain synthetic and ineligible for high-risk motion');
  }
  if (!Array.isArray(input.routes) || input.routes.length > 0 ||
      !Array.isArray(input.destinations) || input.destinations.length > 0 ||
      !Array.isArray(input.plan_actions) ||
      input.plan_actions.some(item => isRecord(item) && item.risk_level === 'HIGH' && item.safety_decision === 'ALLOW') ||
      !isRecord(input.spatial_guidance) || input.spatial_guidance.movement_authorized !== false ||
      input.spatial_guidance.map_mount_eligible !== false) {
    throw new Error('Mock Live must not contain authorized travel, map mounting or verified destinations');
  }
  // Validate every other official Live cross-reference/field constraint.
  // These local-only substitutes satisfy the official-data type requirements
  // without changing the original synthetic evidence.
  const validated = liveSnapshotSchema.parse({
    ...input,
    source: { ...input.source as object, source_url: 'https://mock.invalid/jma' },
    destination_source: { ...input.destination_source as object, source_url: 'https://mock.invalid/destinations' },
    route_source: { ...input.route_source as object, source_url: 'https://mock.invalid/routes' },
    official_sources: officialSources.map((source, index) => ({ ...source as object, source_url: `https://mock.invalid/official/${index}` })),
    events: input.events.map(item => ({ ...item, is_synthetic: false })),
    evidence: input.evidence.map(item => ({ ...item, is_synthetic: false })),
  });
  return {
    ...validated,
    source: input.source as MockLiveSnapshot['source'],
    destination_source: input.destination_source as MockLiveSnapshot['destination_source'],
    route_source: input.route_source as MockLiveSnapshot['route_source'],
    official_sources: officialSources as MockLiveSnapshot['official_sources'],
    events: input.events as MockLiveEvent[],
    evidence: input.evidence as MockEvidence[],
  };
}

export const mockLiveSnapshotSchema = z.unknown().transform((input, ctx): MockLiveSnapshot => {
  try {
    return parseMockLiveSnapshot(input);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid synthetic Mock Live payload' });
    return z.NEVER;
  }
});
