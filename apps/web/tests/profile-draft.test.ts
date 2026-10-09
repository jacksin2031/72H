import { describe, expect, it } from 'vitest';
import { clearProfileDraft, profileDraftFor, readProfileDraft, validateProfileDraft, writeProfileDraft } from '../lib/profile-draft';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const draft = {
  accommodation: 'Asakusa', accommodationArea: 'JP-13' as const, partySize: 3,
  safety: 'UNCERTAIN' as const, accessibilityConstraints: ['MOBILITY_SUPPORT'],
};

describe('session-scoped profile drafts', () => {
  it('round-trips only bounded profile fields under the caller supplied session key', () => {
    const storage = new MemoryStorage();
    expect(writeProfileDraft(storage, '72h-live-profile-draft:session-a', draft)).toBe(true);
    expect(readProfileDraft(storage, '72h-live-profile-draft:session-a')).toEqual({ draft, unavailable: false });
    expect(readProfileDraft(storage, '72h-live-profile-draft:session-b')).toEqual({ draft: null, unavailable: false });
    expect(storage.getItem('72h-live-profile-draft:session-a')).not.toMatch(/latitude|longitude|lat|lng/i);
  });

  it('rejects out-of-range values and removes malformed saved data before it can be restored', () => {
    const storage = new MemoryStorage();
    expect(validateProfileDraft({ version: 1, ...draft, partySize: 21 })).toBeNull();
    expect(writeProfileDraft(storage, 'draft', { ...draft, accommodation: 'x'.repeat(241) })).toBe(false);
    storage.setItem('draft', JSON.stringify({ version: 1, ...draft, accessibilityConstraints: ['x'.repeat(241)] }));
    expect(readProfileDraft(storage, 'draft')).toEqual({ draft: null, unavailable: false });
    expect(storage.getItem('draft')).toBeNull();
  });

  it('does not clear a failed save and reports storage access failures', () => {
    const storage = new MemoryStorage();
    writeProfileDraft(storage, 'draft', draft);
    // A failed API save leaves the saved draft intact; only explicit clear or save success calls removeItem.
    expect(readProfileDraft(storage, 'draft').draft).toEqual(draft);
    expect(storage.getItem('draft')).not.toBeNull();
    const unavailable = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(readProfileDraft(unavailable, 'draft')).toEqual({ draft: null, unavailable: true });
    expect(writeProfileDraft(unavailable, 'draft', draft)).toBe(false);
    expect(clearProfileDraft(unavailable, 'draft')).toBe(false);
  });

  it('builds a draft without adding location coordinates', () => {
    expect(profileDraftFor({
      accommodation_location: { label: 'Asakusa', lat: null, lng: null, area_ids: ['JP-13', 'JP'], observed_at: null, source: null },
      party_size: 3, self_reported_safety_status: 'SAFE', accessibility_constraints: ['VISION_SUPPORT'],
    })).toEqual({ accommodation: 'Asakusa', accommodationArea: 'JP-13', partySize: 3, safety: 'SAFE', accessibilityConstraints: ['VISION_SUPPORT'] });
  });
});
