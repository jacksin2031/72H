import type { JapanShelterPlace } from './japan-shelters';
import { findRoadCandidates, haversine, type RoadCandidate, type RoadCandidateReason, type RoadPoint, type RoadReferenceGraph } from './road-graph-core';
import { tileIdFor } from './road-tiles';

export type RoadHazard = 'tsunami' | 'earthquake';

export type RoadDestination = {
  place: JapanShelterPlace;
  straight_m: number;
  road: RoadCandidate | null;
  reason: RoadCandidateReason | null;
};

function comparePlaceId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Selects hazard-designated emergency sites and attaches reference candidates to the three nearest only. */
export function roadDestinations(
  graph: RoadReferenceGraph | null,
  origin: RoadPoint,
  places: readonly JapanShelterPlace[],
  hazard: RoadHazard,
): { destinations: RoadDestination[]; none: boolean } {
  const eligible = places
    .filter((place) => place.kind === 'EMERGENCY_SITE' && place.hazards[hazard] === 'DESIGNATED')
    .map((place) => ({ place, straight_m: haversine(origin, place) }))
    .sort((left, right) => left.straight_m - right.straight_m || comparePlaceId(left.place.id, right.place.id));
  const nearest = eligible.slice(0, 5);
  const sourcePackIds = new Set(graph?.sources.map((source) => source.pack_id) ?? []);
  const hasTileSources = [...sourcePackIds].some((packId) => packId.startsWith('osm-tile-'));

  const destinations = nearest.map(({ place, straight_m }, index): RoadDestination => {
    if (!graph || index >= 3) return { place, straight_m, road: null, reason: null };
    if (hasTileSources && !sourcePackIds.has(`osm-tile-${tileIdFor(place.lat, place.lng)}-v1`)) {
      return { place, straight_m, road: null, reason: null };
    }
    const result = findRoadCandidates(graph, origin, { lat: place.lat, lng: place.lng });
    return { place, straight_m, road: result.candidates[0] ?? null, reason: result.reason };
  });

  return { destinations, none: eligible.length === 0 };
}
