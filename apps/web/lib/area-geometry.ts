/** Administrative relevance only. Geometry never grants official authority or movement. */
export type AreaEntry = { id: string; label: string; parent_id: string | null };
export type AreaFeature = { id: number; area_id: string; prefecture_id: string; bbox: number[]; rings: number[][][]; uncertain_scope: string | null };
export type AreaFix = { latitude: number; longitude: number; accuracy_m: number };
export type AreaResolution = { area_ids: string[]; label: string; status: 'RESOLVED' | 'AMBIGUOUS' | 'UNAVAILABLE' | 'OUTSIDE' };
export const unavailableArea = (): AreaResolution => ({ area_ids: [], label: '', status: 'UNAVAILABLE' });

export function validAreaFix(fix: AreaFix) {
  return [fix.latitude, fix.longitude, fix.accuracy_m].every(Number.isFinite)
    && Math.abs(fix.latitude) <= 90 && Math.abs(fix.longitude) <= 180 && fix.accuracy_m >= 0 && fix.accuracy_m <= 100_000;
}

export function areaPath(id: string, catalog: AreaEntry[]): string[] {
  const byId = new Map(catalog.map(area => [area.id, area]));
  const path: string[] = [];
  let cursor: string | null = id;
  while (cursor !== null) {
    if (path.length >= 64 || path.includes(cursor)) return [];
    const area = byId.get(cursor);
    if (!area) return [];
    path.push(cursor); cursor = area.parent_id;
  }
  return path.at(-1) === 'JP' ? path : [];
}

export function queryAreaCells(fix: AreaFix, degrees = 0.25): string[] {
  if (!validAreaFix(fix) || !Number.isFinite(degrees) || degrees <= 0) return [];
  // Deliberately overestimate the search box, including the accuracy radius and a 1m numeric guard.
  const dy = (fix.accuracy_m + 1) / 110_000;
  const dx = dy / Math.max(0.01, Math.cos(fix.latitude * Math.PI / 180));
  const cells: string[] = [];
  for (let x = Math.floor((fix.longitude - dx) / degrees); x <= Math.floor((fix.longitude + dx) / degrees); x++) {
    for (let y = Math.floor((fix.latitude - dy) / degrees); y <= Math.floor((fix.latitude + dy) / degrees); y++) cells.push(`${x}-${y}`);
  }
  return cells;
}

function contains(rings: number[][][], x: number, y: number) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

function boundaryNear(rings: number[][][], fix: AreaFix) {
  const sx = 110_000 * Math.cos(fix.latitude * Math.PI / 180), sy = 110_000;
  const radius = fix.accuracy_m + 1;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j][0] - fix.longitude) * sx, ay = (ring[j][1] - fix.latitude) * sy;
      const bx = (ring[i][0] - fix.longitude) * sx, by = (ring[i][1] - fix.latitude) * sy;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(ax + t * dx, ay + t * dy) <= radius) return true;
    }
  }
  return false;
}

export function resolveAreaFeatures(fix: AreaFix, features: AreaFeature[], catalog: AreaEntry[]): AreaResolution {
  if (!validAreaFix(fix)) return unavailableArea();
  const candidates: { feature: AreaFeature; inside: boolean; edge: boolean }[] = [];
  const seen = new Set<number>();
  const dy = (fix.accuracy_m + 1) / 110_000;
  const dx = dy / Math.max(0.01, Math.cos(fix.latitude * Math.PI / 180));
  for (const feature of features) {
    if (seen.has(feature.id)) continue;
    seen.add(feature.id);
    const [w, s, e, n] = feature.bbox;
    if (e < fix.longitude - dx || w > fix.longitude + dx || n < fix.latitude - dy || s > fix.latitude + dy) continue;
    const inside = contains(feature.rings, fix.longitude, fix.latitude);
    const edge = boundaryNear(feature.rings, fix);
    if (inside || edge) candidates.push({ feature, inside, edge });
  }
  if (!candidates.some(candidate => candidate.inside)) return { area_ids: [], label: '', status: 'OUTSIDE' };
  const paths = candidates.map(({ feature }) => areaPath(feature.uncertain_scope ?? feature.area_id, catalog));
  if (paths.some(path => !path.length)) return unavailableArea();
  let common = paths[0].filter(id => paths.every(path => path.includes(id)));
  const ambiguous = candidates.some(candidate => !!candidate.feature.uncertain_scope)
    || new Set(candidates.map(candidate => candidate.feature.area_id)).size > 1
    || candidates.some(candidate => candidate.edge);
  // A coast/hole boundary has no neighboring municipality to prove precision; demote it too.
  if (ambiguous && common[0]?.startsWith('JP-MUNI-')) common = common.slice(1);
  if (!common.length) return unavailableArea();
  const labels = new Map(catalog.map(area => [area.id, area.label]));
  const label = common.filter(id => id !== 'JP').reverse().map(id => labels.get(id)).join(' ') || labels.get('JP') || '';
  return { area_ids: common, label, status: ambiguous ? 'AMBIGUOUS' : 'RESOLVED' };
}
