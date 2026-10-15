import { z } from 'zod';
import {
  buildReferenceGraph,
  emptyRoadCandidateResult,
  findRoadCandidates,
  isWithinBounds,
  ROAD_MAX_SNAP_METERS,
  type RoadBounds,
  type RoadCandidateResult,
  type RoadGraphEdge,
  type RoadGraphNode,
  type RoadGraphWay,
  type RoadPoint,
  type RoadReferenceGraph,
} from './road-graph-core';

export {
  haversine,
  tagsAreCandidateEligible,
  type RoadBounds,
  type RoadCandidate,
  type RoadCandidateReason,
  type RoadCandidateResult,
  type RoadCoordinate,
  type RoadGraphEdge,
  type RoadGraphNode,
  type RoadGraphWay,
  type RoadPoint,
  type RoadReferenceGraph,
} from './road-graph-core';

/** OSM geometry is a road candidate only; it never establishes safety or movement authority. */
export const EVACUATION_ROAD_GRAPH_PATH = '/roads/ishinomaki-central-v1/graph.json';
export const EVACUATION_ROAD_GRAPH_SHA256 = '36f436b9ab96e06e7fbb86d8becf398a6bd4bb2a9ebff86f02d7b7e9f7ac5847';
export const EVACUATION_ROAD_GRAPH_BYTES = 730042;
export const EVACUATION_ROAD_BOUNDS = {
  south: 38.4205,
  west: 141.2855,
  north: 38.4475,
  east: 141.3195,
} as const;
export const EVACUATION_ROAD_MAX_SNAP_METERS = ROAD_MAX_SNAP_METERS;

const MAX_ASSET_BYTES = 1_000_000;
const LOAD_TIMEOUT_MS = 10_000;
/** The pinned pack's installed capacity; tighter than the generic core ceiling. */
const ISHINOMAKI_LIMITS = { maxNodes: 9999, maxEdges: 19999 } as const;
const ISHINOMAKI_MAX_WAYS = 5_000;
const SOURCE_RAW_SHA256 = '04b44a37f46e13b13330abad3a74d302eac785ce4a915b9de1c16bfcc80c1062';
const SOURCE_QUERY_SHA256 = 'a8a58a9f0da037aae36832149dcce47d8e68b260b0c70ea83b301b777af55111';
const SOURCE_BASE_TIMESTAMP = '2026-10-13T06:49:25Z';
const SOURCE_RETRIEVED_AT = '2026-10-13T15:51:00+09:00';
const GRAPH_BUILT_AT = '2026-10-13T16:13:38+09:00';

const tagSchema = z.record(z.string().min(1).max(100), z.string().max(1000))
  .refine((tags) => Object.keys(tags).length <= 200, 'Too many OSM tags');
const rawNodeSchema = z.union([
  z.tuple([z.number().int().positive().safe(), z.number().finite(), z.number().finite()]),
  z.tuple([z.number().int().positive().safe(), z.number().finite(), z.number().finite(), tagSchema]),
]);
const rawWaySchema = z.tuple([z.number().int().positive().safe(), tagSchema]);
const rawEdgeSchema = z.union([
  z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()]),
  // Optional fourth field: 1 = forward in the source way, 2 = reverse.
  z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative(), z.union([z.literal(1), z.literal(2)])]),
]);
const sourceSchema = z.object({
  name: z.literal('OpenStreetMap contributors'),
  endpoint: z.literal('https://overpass-api.de/api/interpreter'),
  copyright_url: z.literal('https://www.openstreetmap.org/copyright'),
  license: z.literal('ODbL-1.0'),
  license_url: z.literal('https://opendatacommons.org/licenses/odbl/1-0/'),
  osm_base_timestamp: z.literal(SOURCE_BASE_TIMESTAMP),
  retrieved_at: z.literal(SOURCE_RETRIEVED_AT),
  raw_sha256: z.literal(SOURCE_RAW_SHA256),
  query_sha256: z.literal(SOURCE_QUERY_SHA256),
}).strict();
const rawGraphSchema = z.object({
  schema_version: z.literal(1),
  pack_id: z.literal('ishinomaki-central-walk-v1'),
  role: z.literal('ROAD_REFERENCE_ONLY'),
  movement_authorized: z.literal(false),
  built_at: z.literal(GRAPH_BUILT_AT),
  bounds: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
  capacity: z.tuple([z.literal(9999), z.literal(19999)]),
  counts: z.tuple([z.number().int().positive().max(9999), z.number().int().positive().max(5000), z.number().int().positive().max(19999)]),
  source: sourceSchema,
  nodes: z.array(rawNodeSchema).min(2).max(9999),
  ways: z.array(rawWaySchema).min(1).max(5000),
  edges: z.array(rawEdgeSchema).min(1).max(19999),
}).strict();

export type RoadGraphSource = z.infer<typeof sourceSchema>;
export type RoadGraphManifest = Readonly<{
  pack_id: 'ishinomaki-central-walk-v1';
  bounds: RoadBounds;
  reviewed_at: string;
  review_due_at: string;
  built_at: string;
  asset_sha256: typeof EVACUATION_ROAD_GRAPH_SHA256;
  asset_bytes: number;
  capacity: Readonly<{ max_nodes: 9999; max_edges: 19999 }>;
  counts: Readonly<{ nodes: number; ways: number; edges: number }>;
  role: 'ROAD_REFERENCE_ONLY';
  movement_authorized: false;
  source: RoadGraphSource;
  pilot_starting_point: Readonly<{ node_osm_id: 461190495; name: '石巻駅前'; lat: 38.4333737; lng: 141.3037166 }>;
}>;
export type RoadGraphPack = Readonly<{
  manifest: RoadGraphManifest;
  nodes: readonly RoadGraphNode[];
  ways: readonly RoadGraphWay[];
  edges: readonly RoadGraphEdge[];
}>;

type RawGraph = z.infer<typeof rawGraphSchema>;

const review = {
  reviewed_at: '2026-10-13T16:13:38+09:00',
  review_due_at: '2027-01-11T16:13:38+09:00',
} as const;

function parseAndBuildPack(value: unknown, byteLength: number): RoadGraphPack {
  const raw: RawGraph = rawGraphSchema.parse(value);
  const [south, west, north, east] = raw.bounds;
  if (south !== EVACUATION_ROAD_BOUNDS.south || west !== EVACUATION_ROAD_BOUNDS.west
    || north !== EVACUATION_ROAD_BOUNDS.north || east !== EVACUATION_ROAD_BOUNDS.east) {
    throw new Error('Unexpected road graph bounds');
  }
  if (raw.counts[0] !== raw.nodes.length || raw.counts[1] !== raw.ways.length || raw.counts[2] !== raw.edges.length) {
    throw new Error('Road graph declared count mismatch');
  }
  if (raw.nodes.length >= 10_000 || raw.edges.length >= 20_000 || byteLength > MAX_ASSET_BYTES) {
    throw new Error('Road graph exceeds installed capacity');
  }

  // Generic invariants (bounds, eligibility, identities, references, pedestrian direction, recomputed lengths,
  // connectivity) are enforced by the core; the pinned Ishinomaki checks stay here.
  const { nodes, ways, edges } = buildReferenceGraph({
    bounds: EVACUATION_ROAD_BOUNDS,
    nodes: raw.nodes.map(([osm_id, lat, lng, tags]) => ({ osm_id, lat, lng, tags: tags ?? {} })),
    ways: raw.ways.map(([osm_id, tags]) => ({ osm_id, tags })),
    edges: raw.edges.map(([from_node_index, to_node_index, way_index, directionCode]) => ({
      from_node_index,
      to_node_index,
      way_index,
      direction: directionCode === 1 ? 'FORWARD' as const : directionCode === 2 ? 'REVERSE' as const : 'BIDIRECTIONAL' as const,
      distance_m: 0,
    })),
    sources: [{ pack_id: raw.pack_id, retrieved_at: raw.source.retrieved_at, osm_base_timestamp: raw.source.osm_base_timestamp }],
  }, ISHINOMAKI_LIMITS);

  const pilotNode = nodes.find((node) => node.osm_id === 461190495);
  if (!pilotNode || pilotNode.lat !== 38.4333737 || pilotNode.lng !== 141.3037166
    || pilotNode.tags.name !== '石巻駅前' || pilotNode.tags.highway !== 'traffic_signals') {
    throw new Error('Pinned pilot reference node is missing');
  }

  return {
    manifest: {
      pack_id: raw.pack_id,
      bounds: { south, west, north, east },
      ...review,
      built_at: raw.built_at,
      asset_sha256: EVACUATION_ROAD_GRAPH_SHA256,
      asset_bytes: byteLength,
      capacity: { max_nodes: 9999, max_edges: 19999 },
      counts: { nodes: nodes.length, ways: ways.length, edges: edges.length },
      role: raw.role,
      movement_authorized: false,
      source: raw.source,
      pilot_starting_point: {
        node_osm_id: 461190495,
        name: '石巻駅前',
        lat: 38.4333737,
        lng: 141.3037166,
      },
    },
    nodes,
    ways,
    edges,
  };
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declared = response.headers.get('content-length');
  if (declared && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    throw new Error('Oversized road graph');
  }
  if (!response.body) {
    const body = await response.arrayBuffer();
    if (body.byteLength > maxBytes) throw new Error('Oversized road graph');
    return body;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error('Oversized road graph');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

/** Load the pinned same-origin road snapshot. Only this public asset URL is requested; coordinates are never sent. */
export async function loadEvacuationRoadGraph(signal?: AbortSignal): Promise<RoadGraphPack> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Road graph load timed out')), LOAD_TIMEOUT_MS);
  try {
    const response = await fetch(EVACUATION_ROAD_GRAPH_PATH, { cache: 'no-cache', signal: controller.signal });
    if (!response.ok) throw new Error('Road graph unavailable');
    const bytes = await readBoundedBody(response, Math.min(MAX_ASSET_BYTES, EVACUATION_ROAD_GRAPH_BYTES));
    if (bytes.byteLength !== EVACUATION_ROAD_GRAPH_BYTES) throw new Error('Road graph byte length mismatch');
    if (!globalThis.crypto?.subtle) throw new Error('Road graph integrity verification unavailable');
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    const actualHash = Array.from(digest, (part) => part.toString(16).padStart(2, '0')).join('');
    if (actualHash !== EVACUATION_ROAD_GRAPH_SHA256) throw new Error('Road graph integrity failure');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return parseAndBuildPack(JSON.parse(text), bytes.byteLength);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Checks the pinned Ishinomaki manifest (hash, byte length, capacity, counts, review dates, bounds) and returns the
 * pack as a generic road reference graph. Throws when a pinned value or a generic invariant does not hold.
 */
export function ishinomakiReferenceGraph(pack: RoadGraphPack): RoadReferenceGraph {
  const manifest = pack?.manifest;
  if (!manifest?.bounds || !manifest.capacity || !manifest.counts || !manifest.source || !Array.isArray(pack.nodes)
    || !Array.isArray(pack.ways) || !Array.isArray(pack.edges)) throw new Error('Invalid road graph pack');
  if (manifest.role !== 'ROAD_REFERENCE_ONLY' || manifest.movement_authorized !== false
    || pack.nodes.length >= 10_000 || pack.edges.length >= 20_000 || pack.ways.length > ISHINOMAKI_MAX_WAYS
    || manifest.asset_sha256 !== EVACUATION_ROAD_GRAPH_SHA256 || manifest.asset_bytes !== EVACUATION_ROAD_GRAPH_BYTES
    || manifest.capacity.max_nodes !== 9999 || manifest.capacity.max_edges !== 19999
    || manifest.counts.nodes !== pack.nodes.length || manifest.counts.ways !== pack.ways.length
    || manifest.counts.edges !== pack.edges.length
    || manifest.reviewed_at !== review.reviewed_at || manifest.review_due_at !== review.review_due_at
    || manifest.bounds.south !== EVACUATION_ROAD_BOUNDS.south || manifest.bounds.west !== EVACUATION_ROAD_BOUNDS.west
    || manifest.bounds.north !== EVACUATION_ROAD_BOUNDS.north || manifest.bounds.east !== EVACUATION_ROAD_BOUNDS.east) {
    throw new Error('Road graph pack does not match the pinned Ishinomaki manifest');
  }
  return buildReferenceGraph({
    bounds: EVACUATION_ROAD_BOUNDS,
    nodes: pack.nodes,
    ways: pack.ways,
    edges: pack.edges,
    sources: [{ pack_id: manifest.pack_id, retrieved_at: manifest.source.retrieved_at, osm_base_timestamp: manifest.source.osm_base_timestamp }],
  }, ISHINOMAKI_LIMITS);
}

/** Pure local calculation. It returns at most the shortest path and one distinct road-graph alternative. */
export function findEvacuationRoadCandidates(pack: RoadGraphPack, origin: RoadPoint, destination: RoadPoint): RoadCandidateResult {
  if (![origin?.lat, origin?.lng, destination?.lat, destination?.lng].every(Number.isFinite)
    || Math.abs(origin.lat) > 90 || Math.abs(destination.lat) > 90 || Math.abs(origin.lng) > 180 || Math.abs(destination.lng) > 180) {
    return emptyRoadCandidateResult('INVALID_COORDINATE');
  }
  if (!pack?.manifest?.bounds || !Array.isArray(pack.nodes) || !Array.isArray(pack.ways) || !Array.isArray(pack.edges)) {
    return emptyRoadCandidateResult('INVALID_GRAPH');
  }
  if (!isWithinBounds(origin, pack.manifest.bounds) || !isWithinBounds(destination, pack.manifest.bounds)) {
    return emptyRoadCandidateResult('OUTSIDE_PACK_BOUNDS');
  }
  let graph: RoadReferenceGraph;
  try {
    graph = ishinomakiReferenceGraph(pack);
  } catch {
    return emptyRoadCandidateResult('INVALID_GRAPH');
  }
  return findRoadCandidates(graph, origin, destination);
}
