/**
 * Generic road reference graph. OSM geometry is a road candidate only; it never establishes safety,
 * passability or movement authority. Every graph built here is ROAD_REFERENCE_ONLY with movement_authorized=false.
 */
export const ROAD_MAX_SNAP_METERS = 100;
/** Absolute ceiling. A caller may tighten these limits but never raise them. */
export const ROAD_GRAPH_LIMITS = { maxNodes: 180_000, maxEdges: 360_000 } as const;
/** Tag limits shared with the backend tile builder (services/agent-api/agent_api/road_tiles.py); lengths are code points. */
export const ROAD_TAG_LIMITS = { maxTags: 200, maxKeyLength: 100, maxValueLength: 1000 } as const;

const EARTH_RADIUS_METERS = 6_371_008.8;
const MAX_SEGMENT_METERS = 1_000;
const MAX_CANDIDATE_METERS = 12_000;
const MAX_ALTERNATIVE_SEARCHES = 12;
const MIN_EDGE_RELAXATIONS_PER_SEARCH = 40_000;

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
export type RoadReferenceSource = Readonly<{ pack_id: string; retrieved_at: string; osm_base_timestamp: string | null }>;
export type RoadGraphLimits = Readonly<{ maxNodes: number; maxEdges: number }>;
export type RoadReferenceGraph = Readonly<{
  role: 'ROAD_REFERENCE_ONLY';
  movement_authorized: false;
  bounds: RoadBounds;
  nodes: readonly RoadGraphNode[];
  ways: readonly RoadGraphWay[];
  edges: readonly RoadGraphEdge[];
  sources: readonly RoadReferenceSource[];
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

type Arc = Readonly<{ to: number; way_index: number; distance_m: number }>;
type PathResult = Readonly<{ node_indices: readonly number[]; way_indices: readonly number[]; distance_m: number }>;

export function haversine(a: RoadPoint, b: RoadPoint): number {
  const radians = Math.PI / 180;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isWithinBounds(point: RoadPoint, bounds: RoadBounds): boolean {
  return point.lat >= bounds.south && point.lat <= bounds.north && point.lng >= bounds.west && point.lng <= bounds.east;
}

const BASIC_HIGHWAYS: ReadonlySet<string> = new Set(['footway', 'path', 'pedestrian', 'steps', 'living_street', 'residential', 'unclassified', 'tertiary', 'service']);
const PUBLIC_ACCESS: ReadonlySet<string> = new Set(['yes', 'permissive']);
const PUBLIC_FOOT_ACCESS: ReadonlySet<string> = new Set(['yes', 'designated', 'permissive']);
const ACCESS_RULES = [
  ['access', PUBLIC_ACCESS],
  ['foot', PUBLIC_FOOT_ACCESS],
  ['access:foot', PUBLIC_FOOT_ACCESS],
] as const;

export function tagsAreCandidateEligible(tags: Readonly<Record<string, string>>): boolean {
  const highway = tags.highway;
  const explicitlyWalkableRoad = ['yes', 'both', 'left', 'right'].includes(tags.sidewalk ?? '')
    || ['yes', 'designated', 'permissive'].includes(tags.foot ?? '');
  if (!BASIC_HIGHWAYS.has(highway ?? '') && !(['primary', 'secondary'].includes(highway ?? '') && explicitlyWalkableRoad)) return false;
  for (const [key, supported] of ACCESS_RULES) {
    if (Object.prototype.hasOwnProperty.call(tags, key) && !supported.has(tags[key])) return false;
  }
  if (tags['access:conditional'] !== undefined || tags['foot:conditional'] !== undefined || tags.motorroad === 'yes') return false;
  if (tags.service && ['driveway', 'parking_aisle', 'drive-through'].includes(tags.service)) return false;
  if (tags['oneway:foot'] && !['no', 'yes', 'true', 'false', '1', '0', '-1'].includes(tags['oneway:foot'])) return false;
  return true;
}

/** The only pedestrian direction a way's oneway:foot tag allows for its edges. */
function expectedDirection(wayTags: Readonly<Record<string, string>>): RoadGraphEdge['direction'] {
  const footOneWay = wayTags['oneway:foot'];
  if (footOneWay === 'yes' || footOneWay === 'true' || footOneWay === '1') return 'FORWARD';
  if (footOneWay === '-1') return 'REVERSE';
  return 'BIDIRECTIONAL';
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _ of value) length += 1;
  return length;
}

function tagsWithinLimits(tags: unknown): tags is Readonly<Record<string, string>> {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return false;
  const entries = Object.entries(tags);
  if (entries.length > ROAD_TAG_LIMITS.maxTags) return false;
  return entries.every(([key, value]) => typeof value === 'string'
    && codePointLength(key) <= ROAD_TAG_LIMITS.maxKeyLength && codePointLength(value) <= ROAD_TAG_LIMITS.maxValueLength);
}

const isOsmId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const isIndex = (value: unknown, length: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;

function validBounds(bounds: RoadBounds | undefined): bounds is RoadBounds {
  return !!bounds && [bounds.south, bounds.west, bounds.north, bounds.east].every(Number.isFinite)
    && bounds.south >= -90 && bounds.north <= 90 && bounds.west >= -180 && bounds.east <= 180
    && bounds.south < bounds.north && bounds.west < bounds.east;
}

function validNode(node: RoadGraphNode | undefined, bounds: RoadBounds): boolean {
  return !!node && Number.isFinite(node.lat) && Number.isFinite(node.lng) && isWithinBounds(node, bounds);
}

/**
 * Validates and freezes a road reference graph. Throws on any violated invariant: role, counts, bounds,
 * candidate-eligible ways, tag limits, edge references, pedestrian direction, recomputed edge length, connectivity.
 * Supplied edge distances are ignored; lengths are always recomputed from the node coordinates.
 */
export function buildReferenceGraph(input: {
  bounds: RoadBounds;
  nodes: readonly RoadGraphNode[];
  ways: readonly RoadGraphWay[];
  edges: readonly RoadGraphEdge[];
  sources: readonly RoadReferenceSource[];
}, limits: RoadGraphLimits = ROAD_GRAPH_LIMITS): RoadReferenceGraph {
  if (!Number.isInteger(limits?.maxNodes) || !Number.isInteger(limits?.maxEdges)
    || limits.maxNodes > ROAD_GRAPH_LIMITS.maxNodes || limits.maxEdges > ROAD_GRAPH_LIMITS.maxEdges) {
    throw new Error('Road graph limits exceed the installed ceiling');
  }
  const { bounds } = input ?? {};
  if (!validBounds(bounds)) throw new Error('Invalid road graph bounds');
  if (!Array.isArray(input.nodes) || !Array.isArray(input.ways) || !Array.isArray(input.edges) || !Array.isArray(input.sources)) {
    throw new Error('Invalid road graph structure');
  }
  if (input.nodes.length < 2 || input.ways.length < 1 || input.edges.length < 1) throw new Error('Road graph is empty');
  if (input.nodes.length > limits.maxNodes || input.edges.length > limits.maxEdges || input.ways.length > limits.maxEdges) {
    throw new Error('Road graph exceeds installed capacity');
  }
  // Array.from turns holes into undefined so a sparse array is validated element by element, never skipped.
  const sources = Array.from(input.sources);
  if (sources.length < 1 || !sources.every((source) => source && typeof source.pack_id === 'string' && source.pack_id.length > 0
    && typeof source.retrieved_at === 'string' && source.retrieved_at.length > 0
    && (source.osm_base_timestamp === null || typeof source.osm_base_timestamp === 'string'))) {
    throw new Error('Road graph source is missing');
  }

  const nodes: RoadGraphNode[] = Array.from(input.nodes, (node) => {
    if (!node || !isOsmId(node.osm_id) || !validNode(node, bounds)) throw new Error('Road graph node outside declared bounds');
    if (!tagsWithinLimits(node.tags)) throw new Error('Road graph node tags exceed limits');
    return Object.freeze({ osm_id: node.osm_id, lat: node.lat, lng: node.lng, tags: Object.freeze({ ...node.tags }) });
  });
  const ways: RoadGraphWay[] = Array.from(input.ways, (way) => {
    if (!way || !isOsmId(way.osm_id) || !tagsWithinLimits(way.tags)) throw new Error('Road graph way tags exceed limits');
    if (!tagsAreCandidateEligible(way.tags)) throw new Error('Road graph contains a non-candidate way');
    return Object.freeze({ osm_id: way.osm_id, tags: Object.freeze({ ...way.tags }) });
  });
  if (new Set(nodes.map((node) => node.osm_id)).size !== nodes.length
    || new Set(ways.map((way) => way.osm_id)).size !== ways.length) {
    throw new Error('Duplicate OSM identity in road graph');
  }

  const edges: RoadGraphEdge[] = [];
  const edgeIdentities = new Set<string>();
  const connectedNodes = new Set<number>();
  for (const edge of input.edges) { // for-of yields holes as undefined, which fail the reference check
    const { from_node_index, to_node_index, way_index, direction } = edge ?? {};
    if (!isIndex(from_node_index, nodes.length) || !isIndex(to_node_index, nodes.length) || !isIndex(way_index, ways.length)
      || from_node_index === to_node_index) throw new Error('Invalid road graph edge reference');
    if (direction !== expectedDirection(ways[way_index].tags)) {
      throw new Error('Road graph pedestrian direction does not match source tags');
    }
    const distance_m = haversine(nodes[from_node_index], nodes[to_node_index]);
    if (!Number.isFinite(distance_m) || distance_m <= 0 || distance_m > MAX_SEGMENT_METERS) {
      throw new Error('Invalid road graph edge length');
    }
    const identity = `${from_node_index}:${to_node_index}:${way_index}:${direction}`;
    if (edgeIdentities.has(identity)) throw new Error('Duplicate road graph edge');
    edgeIdentities.add(identity);
    edges.push(Object.freeze({ from_node_index, to_node_index, way_index, direction, distance_m }));
    connectedNodes.add(from_node_index);
    connectedNodes.add(to_node_index);
  }
  if (connectedNodes.size !== nodes.length) throw new Error('Road graph contains an unconnected node');

  const graph: RoadReferenceGraph = Object.freeze({
    role: 'ROAD_REFERENCE_ONLY',
    movement_authorized: false,
    bounds: Object.freeze({ south: bounds.south, west: bounds.west, north: bounds.north, east: bounds.east }),
    nodes: Object.freeze(nodes),
    ways: Object.freeze(ways),
    edges: Object.freeze(edges),
    sources: Object.freeze(sources.map((source) => Object.freeze({
      pack_id: source.pack_id, retrieved_at: source.retrieved_at, osm_base_timestamp: source.osm_base_timestamp,
    }))),
  });
  builtGraphs.add(graph);
  return graph;
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

/**
 * Graphs returned by buildReferenceGraph. They are deep-frozen, so the adjacency validated for one can be reused.
 * Any other object (a spread copy, a hand-built graph) is never in this set and is re-validated on every search.
 */
const builtGraphs = new WeakSet<RoadReferenceGraph>();
const validatedAdjacency = new WeakMap<RoadReferenceGraph, readonly (readonly Arc[])[]>();
let adjacencyValidations = 0;

/** Test-only: how many times the full search-time validation and adjacency build has run. */
export function adjacencyValidationCountForTests(): number {
  return adjacencyValidations;
}

function adjacencyFor(graph: RoadReferenceGraph): readonly (readonly Arc[])[] | null {
  const cached = validatedAdjacency.get(graph);
  if (cached) return cached;
  const adjacency = buildAdjacency(graph);
  if (adjacency && builtGraphs.has(graph)) validatedAdjacency.set(graph, adjacency);
  return adjacency;
}

/** Re-checks the RoadReferenceGraph invariants at search time; a graph altered after building fails closed. */
function buildAdjacency(graph: RoadReferenceGraph): Arc[][] | null {
  if (graph.role !== 'ROAD_REFERENCE_ONLY' || graph.movement_authorized !== false || !validBounds(graph.bounds)
    || graph.nodes.length < 2 || graph.nodes.length > ROAD_GRAPH_LIMITS.maxNodes
    || graph.edges.length === 0 || graph.edges.length > ROAD_GRAPH_LIMITS.maxEdges
    || graph.ways.length === 0 || graph.ways.length > ROAD_GRAPH_LIMITS.maxEdges) return null;
  adjacencyValidations += 1;
  // Indexed loops: Array.prototype.some skips holes, which would let a sparse array through to a TypeError later.
  for (let index = 0; index < graph.nodes.length; index += 1) {
    if (!validNode(graph.nodes[index], graph.bounds)) return null;
  }
  for (let index = 0; index < graph.ways.length; index += 1) {
    const way = graph.ways[index];
    if (!way?.tags || typeof way.tags !== 'object' || !tagsAreCandidateEligible(way.tags)) return null;
  }
  const adjacency = Array.from({ length: graph.nodes.length }, () => [] as Arc[]);
  for (let index = 0; index < graph.edges.length; index += 1) {
    const edge = graph.edges[index];
    if (!edge || !isIndex(edge.from_node_index, graph.nodes.length) || !isIndex(edge.to_node_index, graph.nodes.length)
      || !isIndex(edge.way_index, graph.ways.length) || edge.from_node_index === edge.to_node_index) return null;
    const direction = edge.direction;
    if (direction !== expectedDirection(graph.ways[edge.way_index].tags)) return null;
    const distance_m = haversine(graph.nodes[edge.from_node_index], graph.nodes[edge.to_node_index]);
    if (!Number.isFinite(distance_m) || distance_m <= 0 || distance_m > MAX_SEGMENT_METERS) return null;
    if (direction !== 'REVERSE') adjacency[edge.from_node_index].push({ to: edge.to_node_index, way_index: edge.way_index, distance_m });
    if (direction !== 'FORWARD') adjacency[edge.to_node_index].push({ to: edge.from_node_index, way_index: edge.way_index, distance_m });
  }
  // Every node must touch an edge (arcs in either direction count).
  const touched = new Uint8Array(graph.nodes.length);
  for (let index = 0; index < graph.edges.length; index += 1) {
    touched[graph.edges[index].from_node_index] = 1;
    touched[graph.edges[index].to_node_index] = 1;
  }
  if (touched.includes(0)) return null;
  return adjacency;
}

function physicalEdgeKey(from: number, to: number, way: number): string {
  return `${Math.min(from, to)}:${Math.max(from, to)}:${way}`;
}

function shortestPath(adjacency: readonly (readonly Arc[])[], start: number, target: number, maxRelaxations: number,
  blockedPhysicalEdge?: string): PathResult | null {
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

  while (heap.size > 0 && relaxations < maxRelaxations) {
    const current = heap.pop()!;
    if (current.distance !== distances[current.node]) continue;
    if (current.node === target) break;
    for (const arc of adjacency[current.node]) {
      relaxations += 1;
      if (relaxations > maxRelaxations) break;
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

function nearestNode(graph: RoadReferenceGraph, point: RoadPoint): { index: number; distance_m: number } | null {
  let closest: { index: number; distance_m: number } | null = null;
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const node = graph.nodes[index];
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

function pathToCandidate(graph: RoadReferenceGraph, path: PathResult, id: RoadCandidate['id'], originGap: number, destinationGap: number): RoadCandidate {
  const roadNames: string[] = [];
  const seenNames = new Set<string>();
  for (const wayIndex of path.way_indices) {
    const tags = graph.ways[wayIndex].tags;
    const name = tags['name:ja'] || tags.name || tags.ref;
    if (name && !seenNames.has(name)) {
      seenNames.add(name);
      roadNames.push(name);
    }
  }
  return {
    id,
    coordinates: path.node_indices.map((index) => [graph.nodes[index].lng, graph.nodes[index].lat] as RoadCoordinate),
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
/** A no-candidate result; it never carries geometry or movement authority. */
export const emptyRoadCandidateResult = emptyResult;

/** Pure local calculation. It returns at most the shortest path and one distinct road-graph alternative. */
export function findRoadCandidates(graph: RoadReferenceGraph, origin: RoadPoint, destination: RoadPoint): RoadCandidateResult {
  if (![origin?.lat, origin?.lng, destination?.lat, destination?.lng].every(Number.isFinite)
    || Math.abs(origin.lat) > 90 || Math.abs(destination.lat) > 90 || Math.abs(origin.lng) > 180 || Math.abs(destination.lng) > 180) {
    return emptyResult('INVALID_COORDINATE');
  }
  if (!graph?.bounds || !Array.isArray(graph.nodes) || !Array.isArray(graph.ways) || !Array.isArray(graph.edges)) {
    return emptyResult('INVALID_GRAPH');
  }
  if (!isWithinBounds(origin, graph.bounds) || !isWithinBounds(destination, graph.bounds)) {
    return emptyResult('OUTSIDE_PACK_BOUNDS');
  }
  const adjacency = adjacencyFor(graph);
  if (!adjacency) return emptyResult('INVALID_GRAPH');
  const maxRelaxations = Math.max(MIN_EDGE_RELAXATIONS_PER_SEARCH, graph.edges.length * 4);
  const nearestOrigin = nearestNode(graph, origin);
  const nearestDestination = nearestNode(graph, destination);
  if (!nearestOrigin || !nearestDestination) return emptyResult('INVALID_GRAPH');
  const originGap = nearestOrigin.distance_m;
  const destinationGap = nearestDestination.distance_m;
  if (originGap > ROAD_MAX_SNAP_METERS) return emptyResult('ORIGIN_TOO_FAR_FROM_ROAD', originGap, destinationGap);
  if (destinationGap > ROAD_MAX_SNAP_METERS) return emptyResult('DESTINATION_TOO_FAR_FROM_ROAD', originGap, destinationGap);
  if (nearestOrigin.index === nearestDestination.index) return emptyResult('SAME_GRAPH_NODE', originGap, destinationGap);

  const primary = shortestPath(adjacency, nearestOrigin.index, nearestDestination.index, maxRelaxations);
  if (!primary) return emptyResult('DISCONNECTED_GRAPH', originGap, destinationGap);
  if (!plausiblePath(primary, graph.nodes)) return emptyResult('IMPLAUSIBLE_DISTANCE', originGap, destinationGap);
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
      const alternative = shortestPath(adjacency, nearestOrigin.index, nearestDestination.index, maxRelaxations, blocked);
      if (!alternative || alternative.node_indices.join(',') === primaryNodeSignature || !plausiblePath(alternative, graph.nodes)) continue;
      if (!paths.some((candidate) => candidate.node_indices.join(',') === alternative.node_indices.join(','))) paths.push(alternative);
    }
  }
  const alternatives = paths.slice(1).sort((a, b) => a.distance_m - b.distance_m || a.node_indices.join(',').localeCompare(b.node_indices.join(','))).slice(0, 1);
  const candidates = [primary, ...alternatives].map((path, index) => pathToCandidate(graph, path, index === 0 ? 'candidate-1' : 'candidate-2', originGap, destinationGap));
  return {
    candidates,
    reason: null,
    origin_gap_m: originGap,
    destination_gap_m: destinationGap,
    map_layer: 'ROAD_REFERENCE_ONLY',
    movement_authorized: false,
  };
}
