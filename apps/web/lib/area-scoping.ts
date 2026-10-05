import type { Evidence, Snapshot } from './contracts';

/** Validate the explicit catalog path; labels and device coordinates never infer an area. */
export function profileAreaIds(snapshot: Snapshot): string[] {
  const declared = snapshot.profile.current_location.area_ids;
  const catalog = new Map(snapshot.area_catalog.map(area => [area.id, area]));
  if (!declared.length || catalog.size !== snapshot.area_catalog.length) return [];
  const actual: string[] = [];
  let cursor: string | null = declared[0];
  while (cursor !== null) {
    const area = catalog.get(cursor);
    if (!area || actual.includes(cursor) || actual.length >= 64) return [];
    actual.push(cursor); cursor = area.parent_id;
  }
  return actual.length === declared.length && actual.every((id, index) => id === declared[index]) ? actual : [];
}

export function evidenceMatchesProfile(evidence: Evidence, snapshot: Snapshot) {
  const areas = profileAreaIds(snapshot);
  const known = new Set(snapshot.area_catalog.map(area => area.id));
  return evidence.affected_area_ids.length > 0
    && evidence.affected_area_ids.every(id => known.has(id))
    && evidence.affected_area_ids.some(id => areas.includes(id));
}
