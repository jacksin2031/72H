import { z } from 'zod';

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
export const EVACUATION_ROAD_MAX_SNAP_METERS = 100;

const MAX_ASSET_BYTES = 1_000_000;
const LOAD_TIMEOUT_MS = 10_000;
const EARTH_RADIUS_METERS = 6_371_008.8;
const MAX_SEGMENT_METERS = 1_000;
const MAX_CANDIDATE_METERS = 12_000;
const MAX_ALTERNATIVE_SEARCHES = 12;
const MAX_EDGE_RELAXATIONS_PER_SEARCH = 40_000;
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

export type RoadBounds = Readonly<{ south: number; west: number; north: number; east: number }>;
export type RoadPoint = Readonly<{ lat: number; lng: number }>;
export type RoadCoordinate = [lng: number, lat: number];
export type RoadGraphNode = Readonly<{ osm_id: number; lat: number; lng: number; tags: Readonly<Record<string, string>> }>;
export type RoadGraphWay = Readonly<{ osm_id: number; tags: Readonly<Record<string, string>> }>;
export type RoadGraphEdge = Readonly<{
  from_node_index: number;
  to_node_index: number;
  way_index: number;
  direction: 'BIDIRECTIONAL' | 'FORWARD' | 'REVERSE';
  distance_m: number;
}>;
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
export type RoadCandidate = Readonly<{
  id: string;
  coordinates: RoadCoordinate[];
  distance_m: number;
  origin_gap_m: number;
  destination_gap_m: number;
  road_names: readonly string[];
}>;
export type RoadCandidateReason =
  | 'INVALID_COORDINATE'
  | 'OUTSIDE_PACK_BOUNDS'
  | 'INVALID_GRAPH'
  | 'ORIGIN_TOO_FAR_FROM_ROAD'
  | 'DESTINATION_TOO_FAR_FROM_ROAD'
  | 'SAME_GRAPH_NODE'
  | 'DISCONNECTED_GRAPH'
  | 'IMPLAUSIBLE_DISTANCE';
export type RoadCandidateResult = Readonly<{
  candidates: RoadCandidate[];
  reason: RoadCandidateReason | null;
  origin_gap_m: number | null;
  destination_gap_m: number | null;
  map_layer: 'ROAD_REFERENCE_ONLY';
  movement_authorized: false;
}>;

type RawGraph = z.infer<typeof rawGraphSchema>;
type Arc = Readonly<{ to: number; way_index: number; distance_m: number }>;
type PathResult = Readonly<{ node_indices: readonly number[]; way_indices: readonly number[]; distance_m: number }>;

const review = {
  reviewed_at: '2026-10-13T16:13:38+09:00',
  review_due_at: '2027-01-11T16:13:38+09:00',
} as const;

function haversine(a: RoadPoint, b: RoadPoint): number {
  const radians = Math.PI / 180;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isWithinBounds(point: RoadPoint, bounds: RoadBounds): boolean {
  return point.lat >= bounds.south && point.lat <= bounds.north && point.lng >= bounds.west && point.lng <= bounds.east;
}

function tagsAreCandidateEligible(tags: Readonly<Record<string, string>>): boolean {
  const highway = tags.highway;
  const basic = new Set(['footway', 'path', 'pedestrian', 'steps', 'living_street', 'residential', 'unclassified', 'tertiary', 'service']);
  const explicitlyWalkableRoad = ['yes', 'both', 'left', 'right'].includes(tags.sidewalk ?? '')
    || ['yes', 'designated', 'permissive'].includes(tags.foot ?? '');
  if (!basic.has(highway ?? '') && !(['primary', 'secondary'].includes(highway ?? '') && explicitlyWalkableRoad)) return false;
  const publicAccess = new Set(['yes', 'permissive']);
  const publicFootAccess = new Set(['yes', 'designated', 'permissive']);
  for (const [key, supported] of [
    ['access', publicAccess],
    ['foot', publicFootAccess],
    ['access:foot', publicFootAccess],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(tags, key) && !supported.has(tags[key])) return false;
  }
  if (tags['access:conditional'] !== undefined || tags['foot:conditional'] !== undefined || tags.motorroad === 'yes') return false;
  if (tags.service && ['driveway', 'parking_aisle', 'drive-through'].includes(tags.service)) return false;
  if (tags['oneway:foot'] && !['no', 'yes', 'true', 'false', '1', '0', '-1'].includes(tags['oneway:foot'])) return false;
  return true;
}

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

  const nodes: RoadGraphNode[] = raw.nodes.map(([osm_id, lat, lng, tags]) => {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || !isWithinBounds({ lat, lng }, EVACUATION_ROAD_BOUNDS)) {
      throw new Error('Road graph node outside declared bounds');
    }
    return { osm_id, lat, lng, tags: tags ?? {} };
  });
  const ways: RoadGraphWay[] = raw.ways.map(([osm_id, tags]) => {
    if (!tagsAreCandidateEligible(tags)) throw new Error('Road graph contains a non-candidate way');
    return { osm_id, tags };
  });
  if (new Set(nodes.map((node) => node.osm_id)).size !== nodes.length
    || new Set(ways.map((way) => way.osm_id)).size !== ways.length) {
    throw new Error('Duplicate OSM identity in road graph');
  }

  const edges: RoadGraphEdge[] = [];
  const edgeIdentities = new Set<string>();
  const connectedNodes = new Set<number>();
  for (const edge of raw.edges) {
    const [from_node_index, to_node_index, way_index, directionCode] = edge;
    if (from_node_index >= nodes.length || to_node_index >= nodes.length || way_index >= ways.length
      || from_node_index === to_node_index) throw new Error('Invalid road graph edge reference');
    const footOneWay = ways[way_index].tags['oneway:foot'];
    const expectedDirection = footOneWay === 'yes' || footOneWay === 'true' || footOneWay === '1' ? 1
      : footOneWay === '-1' ? 2 : undefined;
    if ((expectedDirection !== undefined && directionCode !== expectedDirection)
      || (expectedDirection === undefined && directionCode !== undefined)) {
      throw new Error('Road graph pedestrian direction does not match source tags');
    }
    const distance_m = haversine(nodes[from_node_index], nodes[to_node_index]);
    if (!Number.isFinite(distance_m) || distance_m <= 0 || distance_m > MAX_SEGMENT_METERS) {
      throw new Error('Invalid road graph edge length');
    }
    const direction = directionCode === 1 ? 'FORWARD' : directionCode === 2 ? 'REVERSE' : 'BIDIRECTIONAL';
    const identity = `${from_node_index}:${to_node_index}:${way_index}:${direction}`;
    if (edgeIdentities.has(identity)) throw new Error('Duplicate road graph edge');
    edgeIdentities.add(identity);
    edges.push({ from_node_index, to_node_index, way_index, direction, distance_m });
    connectedNodes.add(from_node_index);
    connectedNodes.add(to_node_index);
  }
  if (connectedNodes.size !== nodes.length) throw new Error('Road graph contains an unconnected node');

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

class MinHeap {
  private readonly values: { node: number; distance: number }[] = [];

  get size(): number { return this.values.length; }

  push(value: { node: number; distance: number }): void {
    let index = this.values.push(value) - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].distance <= value.distance) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): { node: number; distance: number } | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].distance < this.values[left].distance ? right : left;
      if (this.values[child].distance >= last.distance) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function buildAdjacency(pack: RoadGraphPack): Arc[][] | null {
  if (!pack?.manifest?.bounds || !pack.manifest.capacity || !pack.manifest.counts || !Array.isArray(pack.nodes)
    || !Array.isArray(pack.ways) || !Array.isArray(pack.edges)) return null;
  if (pack.manifest.role !== 'ROAD_REFERENCE_ONLY' || pack.manifest.movement_authorized !== false
    || pack.nodes.length < 2 || pack.nodes.length >= 10_000 || pack.edges.length === 0 || pack.edges.length >= 20_000
    || pack.ways.length === 0 || pack.ways.length > 5_000
    || pack.manifest.asset_sha256 !== EVACUATION_ROAD_GRAPH_SHA256 || pack.manifest.asset_bytes !== EVACUATION_ROAD_GRAPH_BYTES
    || pack.manifest.capacity.max_nodes !== 9999 || pack.manifest.capacity.max_edges !== 19999
    || pack.manifest.counts.nodes !== pack.nodes.length || pack.manifest.counts.ways !== pack.ways.length
    || pack.manifest.counts.edges !== pack.edges.length
    || pack.manifest.reviewed_at !== review.reviewed_at || pack.manifest.review_due_at !== review.review_due_at
    || pack.manifest.bounds.south !== EVACUATION_ROAD_BOUNDS.south || pack.manifest.bounds.west !== EVACUATION_ROAD_BOUNDS.west
    || pack.manifest.bounds.north !== EVACUATION_ROAD_BOUNDS.north || pack.manifest.bounds.east !== EVACUATION_ROAD_BOUNDS.east) return null;
  if (pack.nodes.some((node) => !node || !Number.isFinite(node.lat) || !Number.isFinite(node.lng)
    || !isWithinBounds(node, EVACUATION_ROAD_BOUNDS))
    || pack.ways.some((way) => !way?.tags || typeof way.tags !== 'object' || !tagsAreCandidateEligible(way.tags))) return null;
  const adjacency = Array.from({ length: pack.nodes.length }, () => [] as Arc[]);
  for (const edge of pack.edges) {
    if (!Number.isInteger(edge.from_node_index) || !Number.isInteger(edge.to_node_index) || !Number.isInteger(edge.way_index)
      || edge.from_node_index < 0 || edge.from_node_index >= pack.nodes.length
      || edge.to_node_index < 0 || edge.to_node_index >= pack.nodes.length
      || edge.way_index < 0 || edge.way_index >= pack.ways.length || edge.from_node_index === edge.to_node_index) return null;
    const from = pack.nodes[edge.from_node_index];
    const to = pack.nodes[edge.to_node_index];
    const distance_m = haversine(from, to);
    if (!Number.isFinite(distance_m) || distance_m <= 0 || distance_m > MAX_SEGMENT_METERS) return null;
    const direction = edge.direction;
    if (direction !== 'BIDIRECTIONAL' && direction !== 'FORWARD' && direction !== 'REVERSE') return null;
    if (direction !== 'REVERSE') adjacency[edge.from_node_index].push({ to: edge.to_node_index, way_index: edge.way_index, distance_m });
    if (direction !== 'FORWARD') adjacency[edge.to_node_index].push({ to: edge.from_node_index, way_index: edge.way_index, distance_m });
  }
  return adjacency;
}

function physicalEdgeKey(from: number, to: number, way: number): string {
  return `${Math.min(from, to)}:${Math.max(from, to)}:${way}`;
}

function shortestPath(adjacency: readonly (readonly Arc[])[], start: number, target: number, blockedPhysicalEdge?: string): PathResult | null {
  const distances = new Float64Array(adjacency.length);
  distances.fill(Number.POSITIVE_INFINITY);
  const previousNode = new Int32Array(adjacency.length);
  const previousWay = new Int32Array(adjacency.length);
  previousNode.fill(-1);
  previousWay.fill(-1);
  const heap = new MinHeap();
  distances[start] = 0;
  heap.push({ node: start, distance: 0 });
  let relaxations = 0;

  while (heap.size > 0 && relaxations < MAX_EDGE_RELAXATIONS_PER_SEARCH) {
    const current = heap.pop()!;
    if (current.distance !== distances[current.node]) continue;
    if (current.node === target) break;
    for (const arc of adjacency[current.node]) {
      relaxations += 1;
      if (relaxations > MAX_EDGE_RELAXATIONS_PER_SEARCH) break;
      if (blockedPhysicalEdge && physicalEdgeKey(current.node, arc.to, arc.way_index) === blockedPhysicalEdge) continue;
      const nextDistance = current.distance + arc.distance_m;
      if (nextDistance < distances[arc.to]) {
        distances[arc.to] = nextDistance;
        previousNode[arc.to] = current.node;
        previousWay[arc.to] = arc.way_index;
        heap.push({ node: arc.to, distance: nextDistance });
      }
    }
  }
  if (!Number.isFinite(distances[target]) || start === target) return null;
  const reversedNodes = [target];
  const reversedWays: number[] = [];
  let cursor = target;
  while (cursor !== start) {
    const previous = previousNode[cursor];
    const way = previousWay[cursor];
    if (previous < 0 || way < 0 || reversedNodes.length > adjacency.length) return null;
    reversedWays.push(way);
    reversedNodes.push(previous);
    cursor = previous;
  }
  reversedNodes.reverse();
  reversedWays.reverse();
  return { node_indices: reversedNodes, way_indices: reversedWays, distance_m: distances[target] };
}

function nearestNode(pack: RoadGraphPack, point: RoadPoint): { index: number; distance_m: number } | null {
  let closest: { index: number; distance_m: number } | null = null;
  for (let index = 0; index < pack.nodes.length; index += 1) {
    const node = pack.nodes[index];
    const distance_m = haversine(point, node);
    if (!Number.isFinite(distance_m)) return null;
    if (!closest || distance_m < closest.distance_m) closest = { index, distance_m };
  }
  return closest;
}

function plausiblePath(path: PathResult, nodes: readonly RoadGraphNode[]): boolean {
  if (path.node_indices.length < 2 || path.way_indices.length !== path.node_indices.length - 1
    || !Number.isFinite(path.distance_m) || path.distance_m <= 0 || path.distance_m > MAX_CANDIDATE_METERS) return false;
  const start = nodes[path.node_indices[0]];
  const end = nodes[path.node_indices.at(-1)!];
  const direct = haversine(start, end);
  return path.distance_m + 1 >= direct && path.distance_m <= Math.max(1_500, direct * 12 + 250);
}

function pathToCandidate(pack: RoadGraphPack, path: PathResult, id: RoadCandidate['id'], originGap: number, destinationGap: number): RoadCandidate {
  const roadNames: string[] = [];
  const seenNames = new Set<string>();
  for (const wayIndex of path.way_indices) {
    const tags = pack.ways[wayIndex].tags;
    const name = tags['name:ja'] || tags.name || tags.ref;
    if (name && !seenNames.has(name)) {
      seenNames.add(name);
      roadNames.push(name);
    }
  }
  return {
    id,
    coordinates: path.node_indices.map((index) => [pack.nodes[index].lng, pack.nodes[index].lat] as RoadCoordinate),
    distance_m: path.distance_m,
    origin_gap_m: originGap,
    destination_gap_m: destinationGap,
    road_names: roadNames,
  };
}

const emptyResult = (reason: RoadCandidateReason, originGap: number | null = null, destinationGap: number | null = null): RoadCandidateResult => ({
  candidates: [],
  reason,
  origin_gap_m: originGap,
  destination_gap_m: destinationGap,
  map_layer: 'ROAD_REFERENCE_ONLY',
  movement_authorized: false,
});

/** Pure local calculation. It returns at most the shortest path and one distinct road-graph alternative. */
export function findEvacuationRoadCandidates(pack: RoadGraphPack, origin: RoadPoint, destination: RoadPoint): RoadCandidateResult {
  if (![origin?.lat, origin?.lng, destination?.lat, destination?.lng].every(Number.isFinite)
    || Math.abs(origin.lat) > 90 || Math.abs(destination.lat) > 90 || Math.abs(origin.lng) > 180 || Math.abs(destination.lng) > 180) {
    return emptyResult('INVALID_COORDINATE');
  }
  if (!pack?.manifest?.bounds || !Array.isArray(pack.nodes) || !Array.isArray(pack.ways) || !Array.isArray(pack.edges)) {
    return emptyResult('INVALID_GRAPH');
  }
  if (!isWithinBounds(origin, pack.manifest.bounds) || !isWithinBounds(destination, pack.manifest.bounds)) {
    return emptyResult('OUTSIDE_PACK_BOUNDS');
  }
  const adjacency = buildAdjacency(pack);
  if (!adjacency) return emptyResult('INVALID_GRAPH');
  const nearestOrigin = nearestNode(pack, origin);
  const nearestDestination = nearestNode(pack, destination);
  if (!nearestOrigin || !nearestDestination) return emptyResult('INVALID_GRAPH');
  const originGap = nearestOrigin.distance_m;
  const destinationGap = nearestDestination.distance_m;
  if (originGap > EVACUATION_ROAD_MAX_SNAP_METERS) return emptyResult('ORIGIN_TOO_FAR_FROM_ROAD', originGap, destinationGap);
  if (destinationGap > EVACUATION_ROAD_MAX_SNAP_METERS) return emptyResult('DESTINATION_TOO_FAR_FROM_ROAD', originGap, destinationGap);
  if (nearestOrigin.index === nearestDestination.index) return emptyResult('SAME_GRAPH_NODE', originGap, destinationGap);

  const primary = shortestPath(adjacency, nearestOrigin.index, nearestDestination.index);
  if (!primary) return emptyResult('DISCONNECTED_GRAPH', originGap, destinationGap);
  if (!plausiblePath(primary, pack.nodes)) return emptyResult('IMPLAUSIBLE_DISTANCE', originGap, destinationGap);
  const paths: PathResult[] = [primary];
  const primaryNodeSignature = primary.node_indices.join(',');
  const blockedPositions = new Set<number>();
  const edgeCount = primary.way_indices.length;
  const searches = Math.min(MAX_ALTERNATIVE_SEARCHES, edgeCount);
  if (searches > 0) {
    for (let position = 0; position < searches; position += 1) {
      const edgePosition = searches === 1 ? 0 : Math.floor(position * (edgeCount - 1) / (searches - 1));
      if (blockedPositions.has(edgePosition)) continue;
      blockedPositions.add(edgePosition);
      const from = primary.node_indices[edgePosition];
      const to = primary.node_indices[edgePosition + 1];
      const blocked = physicalEdgeKey(from, to, primary.way_indices[edgePosition]);
      const alternative = shortestPath(adjacency, nearestOrigin.index, nearestDestination.index, blocked);
      if (!alternative || alternative.node_indices.join(',') === primaryNodeSignature || !plausiblePath(alternative, pack.nodes)) continue;
      if (!paths.some((candidate) => candidate.node_indices.join(',') === alternative.node_indices.join(','))) paths.push(alternative);
    }
  }
  const alternatives = paths.slice(1).sort((a, b) => a.distance_m - b.distance_m || a.node_indices.join(',').localeCompare(b.node_indices.join(','))).slice(0, 1);
  const candidates = [primary, ...alternatives].map((path, index) => pathToCandidate(pack, path, index === 0 ? 'candidate-1' : 'candidate-2', originGap, destinationGap));
  return {
    candidates,
    reason: null,
    origin_gap_m: originGap,
    destination_gap_m: destinationGap,
    map_layer: 'ROAD_REFERENCE_ONLY',
    movement_authorized: false,
  };
}
