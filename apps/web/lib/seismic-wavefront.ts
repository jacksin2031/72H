import { documentedEpicenters, greatCircleKm, kumamotoSecondEarthquake, validPoint, type Epicenter } from './geospatial-exposure';
import { JAPAN_VIEW_BOUNDS } from './japan-reference-map';

export const WAVE_SPEED_SOURCE = 'https://www.jma.go.jp/jma/kishou/know/jishin/eew/shikumi/shikumi.html';
export const WAVE_SPEED_KM_S = { P: 7, S: 4 } as const;
const EARTH_RADIUS_KM = 6371.0088;
export type WavefrontData = { type:'FeatureCollection'; features:{
  type:'Feature'; properties:{phase:'P'|'S';radius_km:number;origin_jst:string;source_url:string};
  geometry:{type:'MultiLineString';coordinates:number[][][]};
}[] };
const TOHOKU_SOURCE = 'https://ds.data.jma.go.jp/eqev/data/gaikyo/monthly/201103/monthly201103.pdf';
// JMA monthly bulletin: mainshock 14:46:18.1; Ibaraki aftershock
// 15:15:34.4, 36°06.5′N / 141°15.9′E, depth 43 km (p.60).
export const tohokuWaveOrigins: readonly Epicenter[] = [
  { ...documentedEpicenters['tohoku-2011'], observed_at_jst: '2011-03-11T14:46:18.100+09:00', source_url: TOHOKU_SOURCE },
  { lat: 36 + 6.5 / 60, lng: 141 + 15.9 / 60, depth_km: 43, magnitude: 7.6,
    case_id: 'tohoku-2011', observed_at_jst: '2011-03-11T15:15:34.400+09:00', source_url: TOHOKU_SOURCE },
];

/** Match known origins to the selected historical window. Never reuse a
 * mainshock's coordinates/time for an undocumented aftershock or custom event. */
export function seismicOriginsForMilestones(caseId: string | null, milestones: readonly { kind: string; at_jst: string }[]): Epicenter[] {
  const origin = caseId ? documentedEpicenters[caseId] : null;
  const candidates = caseId === 'tohoku-2011' ? tohokuWaveOrigins
    : caseId === 'kumamoto-2016' ? [origin!, kumamotoSecondEarthquake] : origin ? [origin] : [];
  return candidates.filter(candidate => milestones.some(m =>
    (m.kind === 'EARTHQUAKE' || m.kind === 'AFTERSHOCK')
    && Math.floor(Date.parse(m.at_jst) / 60_000) === Math.floor(Date.parse(candidate.observed_at_jst) / 60_000)));
}

/** Display horizon only; no assertion about shaking duration or safe areas. */
export function waveMapRadiusKm(origin: Epicenter): number {
  return Math.max(...JAPAN_VIEW_BOUNDS.flatMap(([lng]) => JAPAN_VIEW_BOUNDS.map(([, lat]) =>
    greatCircleKm(origin, { lat, lng })))) + 100;
}

function validOrigin(origin: Epicenter): boolean {
  return validPoint(origin) && Number.isFinite(origin.depth_km) && origin.depth_km >= 0 && origin.depth_km < 700
    && Number.isFinite(Date.parse(origin.observed_at_jst));
}

/** Homogeneous constant-speed point-source approximation, not measured waves,
 * JMA travel-time tables, intensity, rupture extent, or safety eligibility.
 * Intersect the expanding 3-D wave sphere with Earth's surface, then draw a
 * geodesic circle. Thus distance remains kilometres at every map zoom. */
export function waveRadiusKm(origin: Epicenter, timeMs: number, phase: 'P' | 'S'): number | null {
  if (!validOrigin(origin) || !Number.isFinite(timeMs)) return null;
  const seconds = (timeMs - Date.parse(origin.observed_at_jst)) / 1000;
  const travelled = seconds * WAVE_SPEED_KM_S[phase];
  if (seconds < 0 || travelled <= origin.depth_km) return null;
  const innerRadius = EARTH_RADIUS_KM - origin.depth_km;
  const cosine = (EARTH_RADIUS_KM ** 2 + innerRadius ** 2 - travelled ** 2) / (2 * EARTH_RADIUS_KM * innerRadius);
  if (cosine < -1) return null;
  const radius = EARTH_RADIUS_KM * Math.acos(Math.max(-1, Math.min(1, cosine)));
  return radius > waveMapRadiusKm(origin) ? null : radius;
}

export function seismicWaveEndMs(origins: readonly Epicenter[]): number | null {
  const deadlines = origins.filter(validOrigin).map(origin => {
    const innerRadius = EARTH_RADIUS_KM - origin.depth_km;
    const chord = Math.sqrt(EARTH_RADIUS_KM ** 2 + innerRadius ** 2
      - 2 * EARTH_RADIUS_KM * innerRadius * Math.cos(waveMapRadiusKm(origin) / EARTH_RADIUS_KM));
    return Date.parse(origin.observed_at_jst) + chord / WAVE_SPEED_KM_S.S * 1000 + 1000;
  });
  return deadlines.length ? Math.max(...deadlines) : null;
}

function circleCoordinates(origin: Epicenter, radiusKm: number): number[][] {
  const lat = origin.lat * Math.PI / 180, lng = origin.lng * Math.PI / 180;
  const angle = radiusKm / EARTH_RADIUS_KM;
  return Array.from({ length: 181 }, (_, index) => {
    const bearing = index * Math.PI / 90;
    const targetLat = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(bearing));
    const targetLng = lng + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(lat), Math.cos(angle) - Math.sin(lat) * Math.sin(targetLat));
    return [((targetLng * 180 / Math.PI + 540) % 360) - 180, targetLat * 180 / Math.PI];
  });
}

// Avoid drawing a false line across Japan when a large circle crosses ±180°.
function splitDateline(points: number[][]): number[][][] {
  const lines: number[][][] = [[points[0]]];
  for(let i=1;i<points.length;i++) {
    const previous=points[i-1], next=points[i];
    if(Math.abs(next[0]-previous[0])>180) {
      const edge=previous[0]>0?180:-180;
      const unwrapped=next[0]+(previous[0]>0?360:-360);
      const latitude=previous[1]+(next[1]-previous[1])*(edge-previous[0])/(unwrapped-previous[0]);
      lines.at(-1)!.push([edge,latitude]);
      lines.push([[-edge,latitude]]);
    }
    lines.at(-1)!.push(next);
  }
  return lines;
}

export function seismicWavefronts(origins: readonly Epicenter[], timeMs: number): WavefrontData {
  return { type: 'FeatureCollection', features: origins.flatMap(origin => (['P', 'S'] as const).flatMap(phase => {
    const radius = waveRadiusKm(origin, timeMs, phase);
    return radius === null ? [] : [{ type: 'Feature' as const,
      properties: { phase, radius_km: radius, origin_jst: origin.observed_at_jst, source_url: origin.source_url },
      geometry: { type: 'MultiLineString' as const, coordinates: splitDateline(circleCoordinates(origin, radius)) },
    }];
  })) };
}
