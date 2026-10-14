import { readFile } from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EVACUATION_ROAD_BOUNDS,
  EVACUATION_ROAD_GRAPH_BYTES,
  EVACUATION_ROAD_GRAPH_PATH,
  EVACUATION_ROAD_GRAPH_SHA256,
  findEvacuationRoadCandidates,
  loadEvacuationRoadGraph,
  type RoadGraphPack,
} from '../lib/evacuation-road-graph';

let assetBytes: Uint8Array;

beforeAll(async () => {
  assetBytes = new Uint8Array(await readFile(new URL('../public/roads/ishinomaki-central-v1/graph.json', import.meta.url)));
});

afterEach(() => vi.unstubAllGlobals());

function installAssetFetch(bytes = assetBytes) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe(EVACUATION_ROAD_GRAPH_PATH);
    return new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { 'content-length': String(bytes.byteLength) } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function syntheticPack(): RoadGraphPack {
  const base = {
    pack_id: 'ishinomaki-central-walk-v1' as const,
    bounds: EVACUATION_ROAD_BOUNDS,
    reviewed_at: '2026-10-13T16:13:38+09:00' as const,
    review_due_at: '2027-01-11T16:13:38+09:00' as const,
    built_at: '2026-10-13T16:13:38+09:00',
    asset_sha256: EVACUATION_ROAD_GRAPH_SHA256 as typeof EVACUATION_ROAD_GRAPH_SHA256,
    asset_bytes: EVACUATION_ROAD_GRAPH_BYTES,
    capacity: { max_nodes: 9999 as const, max_edges: 19999 as const },
    counts: { nodes: 4, ways: 4, edges: 4 },
    role: 'ROAD_REFERENCE_ONLY' as const,
    movement_authorized: false as const,
    source: {
      name: 'OpenStreetMap contributors' as const,
      endpoint: 'https://overpass-api.de/api/interpreter' as const,
      copyright_url: 'https://www.openstreetmap.org/copyright' as const,
      license: 'ODbL-1.0' as const,
      license_url: 'https://opendatacommons.org/licenses/odbl/1-0/' as const,
      osm_base_timestamp: '2026-10-13T06:49:25Z' as const,
      retrieved_at: '2026-10-13T15:51:00+09:00' as const,
      raw_sha256: '04b44a37f46e13b13330abad3a74d302eac785ce4a915b9de1c16bfcc80c1062' as const,
      query_sha256: 'a8a58a9f0da037aae36832149dcce47d8e68b260b0c70ea83b301b777af55111' as const,
    },
    pilot_starting_point: { node_osm_id: 461190495 as const, name: '石巻駅前' as const, lat: 38.4333737 as const, lng: 141.3037166 as const },
  };
  const nodes = [
    { osm_id: 1, lat: 38.433, lng: 141.303, tags: {} },
    { osm_id: 2, lat: 38.433, lng: 141.304, tags: {} },
    { osm_id: 3, lat: 38.434, lng: 141.303, tags: {} },
    { osm_id: 4, lat: 38.434, lng: 141.304, tags: {} },
  ];
  const ways = [0, 1, 2, 3].map((osm_id) => ({ osm_id: osm_id + 10, tags: { highway: 'residential', name: `road-${osm_id}` } }));
  const edges = [
    { from_node_index: 0, to_node_index: 1, way_index: 0, direction: 'BIDIRECTIONAL' as const, distance_m: 0 },
    { from_node_index: 1, to_node_index: 3, way_index: 1, direction: 'BIDIRECTIONAL' as const, distance_m: 0 },
    { from_node_index: 0, to_node_index: 2, way_index: 2, direction: 'BIDIRECTIONAL' as const, distance_m: 0 },
    { from_node_index: 2, to_node_index: 3, way_index: 3, direction: 'BIDIRECTIONAL' as const, distance_m: 0 },
  ];
  return { manifest: base, nodes, ways, edges };
}

describe('loadEvacuationRoadGraph', () => {
  it('loads a bounded, hashed source snapshot with strict manifest metadata', async () => {
    const fetchMock = installAssetFetch();
    const pack = await loadEvacuationRoadGraph();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pack.manifest).toMatchObject({
      pack_id: 'ishinomaki-central-walk-v1',
      bounds: EVACUATION_ROAD_BOUNDS,
      reviewed_at: '2026-10-13T16:13:38+09:00',
      review_due_at: '2027-01-11T16:13:38+09:00',
      asset_sha256: EVACUATION_ROAD_GRAPH_SHA256,
      asset_bytes: EVACUATION_ROAD_GRAPH_BYTES,
      capacity: { max_nodes: 9999, max_edges: 19999 },
      counts: { nodes: 9187, ways: 2629, edges: 10318 },
      role: 'ROAD_REFERENCE_ONLY',
      movement_authorized: false,
      pilot_starting_point: { node_osm_id: 461190495, name: '石巻駅前', lat: 38.4333737, lng: 141.3037166 },
    });
    expect(pack.nodes).toHaveLength(9187);
    expect(pack.edges).toHaveLength(10318);
  });

  it('rejects bytes that do not match the reviewed pin before parsing them', async () => {
    const changed = assetBytes.slice();
    changed[changed.length - 1] ^= 1;
    installAssetFetch(changed);
    await expect(loadEvacuationRoadGraph()).rejects.toThrow('Road graph integrity failure');
  });

  it('rejects oversized responses without reading an unbounded payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': '1000001' } })));
    await expect(loadEvacuationRoadGraph()).rejects.toThrow('Oversized road graph');
  });
});

describe('findEvacuationRoadCandidates', () => {
  it('returns only connected graph geometry and never authorizes movement', async () => {
    installAssetFetch();
    const pack = await loadEvacuationRoadGraph();
    const origin = { lat: 38.4333737, lng: 141.3037166 };
    const destination = { lat: 38.4312472, lng: 141.308527 };
    const result = findEvacuationRoadCandidates(pack, origin, destination);

    expect(result.reason).toBeNull();
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates.length).toBeLessThanOrEqual(2);
    expect(result.map_layer).toBe('ROAD_REFERENCE_ONLY');
    expect(result.movement_authorized).toBe(false);
    expect(result.origin_gap_m).toBe(0);
    expect(result.destination_gap_m).toBe(0);
    for (const candidate of result.candidates) {
      expect(candidate.origin_gap_m).toBeLessThanOrEqual(100);
      expect(candidate.destination_gap_m).toBeLessThanOrEqual(100);
      expect(candidate.distance_m).toBeGreaterThan(0);
      expect(candidate.coordinates.length).toBeGreaterThanOrEqual(2);
      expect(candidate.coordinates[0]).toEqual([pack.nodes.find((node) => node.osm_id === 461190495)!.lng, pack.nodes.find((node) => node.osm_id === 461190495)!.lat]);
      for (const [lng, lat] of candidate.coordinates) {
        expect(pack.nodes.some((node) => node.lng === lng && node.lat === lat)).toBe(true);
      }
    }
  });

  it('can produce a road candidate to an in-bounds designated-site catalog coordinate', async () => {
    installAssetFetch();
    const pack = await loadEvacuationRoadGraph();
    // Pinned catalog example: emergency_site:E0420200008201 (羽黒山公園); this is not safety evidence.
    const result = findEvacuationRoadCandidates(pack,
      { lat: pack.manifest.pilot_starting_point.lat, lng: pack.manifest.pilot_starting_point.lng },
      { lat: 38.43095408, lng: 141.3037399 });
    expect(result.reason).toBeNull();
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates[0].distance_m).toBeGreaterThan(0);
    expect(result.candidates[0].origin_gap_m).toBeLessThanOrEqual(100);
    expect(result.candidates[0].destination_gap_m).toBeLessThanOrEqual(100);
    expect(result.movement_authorized).toBe(false);
  });

  it('rejects outside-bounds and over-100m snaps while exposing measured local gaps', async () => {
    const pack = syntheticPack();
    const outside = findEvacuationRoadCandidates(pack, { lat: 38.42, lng: 141.3 }, { lat: 38.433, lng: 141.303 });
    expect(outside).toMatchObject({ candidates: [], reason: 'OUTSIDE_PACK_BOUNDS', origin_gap_m: null, movement_authorized: false });

    const tooFar = findEvacuationRoadCandidates(pack, { lat: 38.4206, lng: 141.2856 }, { lat: 38.433, lng: 141.303 });
    expect(tooFar.reason).toBe('ORIGIN_TOO_FAR_FROM_ROAD');
    expect(tooFar.candidates).toEqual([]);
    expect(tooFar.origin_gap_m).toBeGreaterThan(100);
    expect(tooFar.destination_gap_m).toBeLessThanOrEqual(100);
  });

  it('does not invent a direct connector across disconnected graph components', () => {
    const pack = syntheticPack();
    const disconnected: RoadGraphPack = {
      ...pack,
      manifest: { ...pack.manifest, counts: { ...pack.manifest.counts, edges: 2 } },
      nodes: pack.nodes,
      edges: [pack.edges[0], pack.edges[3]],
    };
    const result = findEvacuationRoadCandidates(disconnected, { lat: 38.433, lng: 141.303 }, { lat: 38.434, lng: 141.304 });
    expect(result).toMatchObject({ candidates: [], reason: 'DISCONNECTED_GRAPH', movement_authorized: false });
  });

  it('fails closed when a supplied pack has inconsistent capacity metadata or edge references', () => {
    const pack = syntheticPack();
    const badReference: RoadGraphPack = {
      ...pack,
      edges: [{ ...pack.edges[0], to_node_index: 99 }, ...pack.edges.slice(1)],
    };
    const badCount: RoadGraphPack = {
      ...pack,
      manifest: { ...pack.manifest, counts: { ...pack.manifest.counts, edges: 3 } },
    };
    const origin = { lat: 38.433, lng: 141.303 };
    const destination = { lat: 38.434, lng: 141.304 };
    expect(findEvacuationRoadCandidates(badReference, origin, destination).reason).toBe('INVALID_GRAPH');
    expect(findEvacuationRoadCandidates(badCount, origin, destination).reason).toBe('INVALID_GRAPH');
  });

  it('returns no more than one distinct alternative, with each geometry following graph edges', () => {
    const pack = syntheticPack();
    const result = findEvacuationRoadCandidates(pack, { lat: 38.433, lng: 141.303 }, { lat: 38.434, lng: 141.304 });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].id).toBe('candidate-1');
    expect(result.candidates[1].id).toBe('candidate-2');
    expect(result.candidates[0].coordinates).not.toEqual(result.candidates[1].coordinates);
    expect(result.candidates.every((candidate) => candidate.road_names.length > 0)).toBe(true);
    expect(result.movement_authorized).toBe(false);
  });
});
