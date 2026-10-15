import { expect, it } from 'vitest';
import { buildReferenceGraph, type RoadPoint } from '../lib/road-graph-core';
import type { JapanShelterPlace } from '../lib/japan-shelters';
import { roadDestinations } from '../lib/road-destinations';

const origin = { lat: 38.41, lng: 141.28 };
type Designation = 'DESIGNATED' | 'NOT_DESIGNATED' | 'UNKNOWN';

function place(
  id: string,
  point: RoadPoint,
  hazards: { tsunami?: Designation; earthquake?: Designation } = {},
  kind: 'EMERGENCY_SITE' | 'SHELTER' = 'EMERGENCY_SITE',
): JapanShelterPlace {
  return {
    id,
    common_id: id,
    name: id,
    address: '',
    lat: point.lat,
    lng: point.lng,
    kind,
    hazards: {
      flood: 'UNKNOWN',
      landslide: 'UNKNOWN',
      storm_surge: 'UNKNOWN',
      earthquake: hazards.earthquake ?? 'UNKNOWN',
      tsunami: hazards.tsunami ?? 'UNKNOWN',
      large_fire: 'UNKNOWN',
      inland_flood: 'UNKNOWN',
      volcano: 'UNKNOWN',
    },
    notes: '',
    source_id: kind === 'SHELTER' ? 'shelters' : 'emergency',
    open_status: 'UNKNOWN',
    municipality_id: '04202',
    municipality_name: '石巻市',
    designation_updated_at: null,
  };
}

function referenceGraph(points: readonly RoadPoint[], packIds = ['ishinomaki-central-walk-v1']) {
  return buildReferenceGraph({
    bounds: { south: 38.39, west: 141.24, north: 38.43, east: 141.31 },
    nodes: points.map((point, index) => ({ osm_id: index + 1, ...point, tags: {} })),
    ways: points.slice(1).map((_, index) => ({ osm_id: index + 101, tags: { highway: 'residential', name: `Road ${index + 1}` } })),
    edges: points.slice(1).map((_, index) => ({
      from_node_index: index,
      to_node_index: index + 1,
      way_index: index,
      direction: 'BIDIRECTIONAL' as const,
      distance_m: 0,
    })),
    sources: packIds.map((pack_id) => ({ pack_id, retrieved_at: '2026-10-15T00:00:00Z', osm_base_timestamp: null })),
  });
}

function eastOfOrigin(index: number): RoadPoint {
  return { lat: origin.lat, lng: origin.lng + index * 0.0003 };
}

it('keeps the nearest five and calculates real roads only for the nearest three', () => {
  const points = [origin, ...Array.from({ length: 7 }, (_, index) => eastOfOrigin(index + 1))];
  const graph = referenceGraph(points);
  const places = Array.from({ length: 7 }, (_, index) => place(`d${index}`, points[index + 1], { tsunami: 'DESIGNATED' })).reverse();

  const result = roadDestinations(graph, origin, places, 'tsunami');

  expect(result.destinations.map((destination) => destination.place.id)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4']);
  expect(result.destinations.slice(0, 3).every((destination) => destination.road !== null)).toBe(true);
  expect(result.destinations.slice(3).every((destination) => destination.road === null)).toBe(true);
  expect(result.destinations.every((destination) => destination.reason === null)).toBe(true);
  expect(result.destinations.every((destination) => destination.place.open_status === 'UNKNOWN')).toBe(true);
  expect(result.none).toBe(false);
});

it('breaks equal-distance ties by place ID regardless of input order', () => {
  const west = { lat: origin.lat, lng: origin.lng - 0.0003 };
  const east = { lat: origin.lat, lng: origin.lng + 0.0003 };
  const result = roadDestinations(referenceGraph([west, origin, east]), origin, [
    place('b', east, { tsunami: 'DESIGNATED' }),
    place('a', west, { tsunami: 'DESIGNATED' }),
  ], 'tsunami');

  expect(result.destinations.map((destination) => destination.place.id)).toEqual(['a', 'b']);
});

it('requires a strict hazard designation on an emergency site when real roads are available', () => {
  const points = [origin, ...Array.from({ length: 5 }, (_, index) => eastOfOrigin(index + 1))];
  const graph = referenceGraph(points);
  const places = [
    place('tsunami-designated', points[1], { tsunami: 'DESIGNATED' }),
    place('tsunami-unknown', points[2], { tsunami: 'UNKNOWN', earthquake: 'DESIGNATED' }),
    place('tsunami-not-designated', points[3], { tsunami: 'NOT_DESIGNATED' }),
    place('shelter-designated', points[4], { tsunami: 'DESIGNATED', earthquake: 'DESIGNATED' }, 'SHELTER'),
    place('earthquake-designated', points[5], { earthquake: 'DESIGNATED' }),
  ];

  const tsunami = roadDestinations(graph, origin, places, 'tsunami');
  const earthquake = roadDestinations(graph, origin, places, 'earthquake');

  expect(tsunami.destinations.map((destination) => destination.place.id)).toEqual(['tsunami-designated']);
  expect(tsunami.destinations[0].road).not.toBeNull();
  expect(earthquake.destinations.map((destination) => destination.place.id)).toEqual(['tsunami-unknown', 'earthquake-designated']);
  expect(earthquake.destinations.every((destination) => destination.road !== null)).toBe(true);
});

it('does not use buffered road nodes when the destination tile is missing', () => {
  const points = [
    { lat: 38.41, lng: 141.2752 },
    { lat: 38.41, lng: 141.2761 },
  ];
  const destination = place('destination', points[1], { tsunami: 'DESIGNATED' });
  const adjacentTile = 'osm-tile-r1920c5650-v1';

  const partial = roadDestinations(referenceGraph(points, [adjacentTile]), points[0], [destination], 'tsunami');
  const complete = roadDestinations(referenceGraph(points, [adjacentTile, 'osm-tile-r1920c5651-v1']), points[0], [destination], 'tsunami');

  expect(partial.destinations[0].road).toBeNull();
  expect(complete.destinations[0].road).not.toBeNull();
});

it('does not widen UNKNOWN or NOT_DESIGNATED places into results', () => {
  const result = roadDestinations(null, origin, [
    place('unknown', origin, { tsunami: 'UNKNOWN' }),
    place('not-designated', origin, { tsunami: 'NOT_DESIGNATED' }),
    place('shelter', origin, { tsunami: 'DESIGNATED' }, 'SHELTER'),
  ], 'tsunami');

  expect(result).toEqual({ destinations: [], none: true });
});

it('keeps designated places when the graph is unavailable but returns no road', () => {
  const designated = place('designated', origin, { tsunami: 'DESIGNATED' });
  const result = roadDestinations(null, origin, [designated], 'tsunami');

  expect(result).toEqual({
    destinations: [{ place: designated, straight_m: 0, road: null, reason: null }],
    none: false,
  });
});
