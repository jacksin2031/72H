import type { LiveProfileSeed } from './contracts';

export type ProfileDraft = {
  accommodation: string;
  accommodationArea: '' | 'JP-13' | 'JP-27';
  partySize: number;
  safety: LiveProfileSeed['self_reported_safety_status'];
  accessibilityConstraints: string[];
};

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type DraftReadResult = { draft: ProfileDraft | null; unavailable: boolean };

const safetyStates = new Set(['SAFE', 'UNCERTAIN', 'NEEDS_ASSISTANCE', 'UNKNOWN']);
const areaChoices = new Set(['', 'JP-13', 'JP-27']);

export function profileDraftFor(profile?: Pick<LiveProfileSeed,
  'accommodation_location' | 'party_size' | 'self_reported_safety_status' | 'accessibility_constraints'>): ProfileDraft {
  const accommodationArea = profile?.accommodation_location.area_ids.find(id => id === 'JP-13' || id === 'JP-27') ?? '';
  return {
    accommodation: profile?.accommodation_location.label ?? '',
    accommodationArea: areaChoices.has(accommodationArea) ? accommodationArea as ProfileDraft['accommodationArea'] : '',
    partySize: profile?.party_size ?? 1,
    safety: profile?.self_reported_safety_status ?? 'UNKNOWN',
    accessibilityConstraints: [...(profile?.accessibility_constraints ?? [])],
  };
}

export function validateProfileDraft(value: unknown): ProfileDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Record<string, unknown>;
  if (draft.version !== 1 || typeof draft.accommodation !== 'string' || draft.accommodation.length > 240
    || typeof draft.accommodationArea !== 'string' || !areaChoices.has(draft.accommodationArea)
    || !Number.isInteger(draft.partySize) || (draft.partySize as number) < 1 || (draft.partySize as number) > 20
    || typeof draft.safety !== 'string' || !safetyStates.has(draft.safety)
    || !Array.isArray(draft.accessibilityConstraints) || draft.accessibilityConstraints.length > 32
    || draft.accessibilityConstraints.some(item => typeof item !== 'string' || item.length > 240)) return null;
  return {
    accommodation: draft.accommodation,
    accommodationArea: draft.accommodationArea as ProfileDraft['accommodationArea'],
    partySize: draft.partySize as number,
    safety: draft.safety as ProfileDraft['safety'],
    accessibilityConstraints: [...draft.accessibilityConstraints] as string[],
  };
}

export function readProfileDraft(storage: DraftStorage, key: string): DraftReadResult {
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return { draft: null, unavailable: true }; }
  if (!raw) return { draft: null, unavailable: false };
  if (raw.length > 8192) {
    try { storage.removeItem(key); } catch { return { draft: null, unavailable: true }; }
    return { draft: null, unavailable: false };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    try { storage.removeItem(key); } catch { return { draft: null, unavailable: true }; }
    return { draft: null, unavailable: false };
  }
  const draft = validateProfileDraft(parsed);
  if (draft) return { draft, unavailable: false };
  try { storage.removeItem(key); } catch { return { draft: null, unavailable: true }; }
  return { draft: null, unavailable: false };
}

export function writeProfileDraft(storage: DraftStorage, key: string, draft: ProfileDraft): boolean {
  const valid = validateProfileDraft({ version: 1, ...draft });
  if (!valid) return false;
  try { storage.setItem(key, JSON.stringify({ version: 1, ...valid })); return true; } catch { return false; }
}

export function clearProfileDraft(storage: DraftStorage, key: string): boolean {
  try { storage.removeItem(key); return true; } catch { return false; }
}

export function hasProfileDraft(storage: DraftStorage, key: string): boolean {
  try { return storage.getItem(key) !== null; } catch { return false; }
}
