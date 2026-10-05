import { z } from 'zod';

export const mapManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), version: z.number().int().positive(),
  bounds: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
  captured_at: z.iso.datetime({ offset: true }), data_timestamp: z.iso.datetime({ offset: true }),
  source: z.literal('OpenStreetMap contributors'), source_url: z.literal('https://www.openstreetmap.org/copyright'),
  license: z.literal('ODbL-1.0'), asset: z.string().regex(/^\/maps\/[a-z0-9][a-z0-9._-]{0,96}\.geojson$/),
  bytes: z.number().int().positive().max(8_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  feature_count: z.number().int().positive().max(20_000),
}).refine(m => m.bounds[0] < m.bounds[2] && m.bounds[1] < m.bounds[3] && m.bounds.every(Number.isFinite), 'Invalid map extent');
export type MapManifest = z.infer<typeof mapManifestSchema>;
export const mapCatalogSchema = z.object({ version: z.literal(1), packs: z.array(mapManifestSchema).max(4) }).superRefine((catalog, ctx) => {
  if (new Set(catalog.packs.map(pack => pack.id)).size !== catalog.packs.length || new Set(catalog.packs.map(pack => pack.asset)).size !== catalog.packs.length) ctx.addIssue({ code: 'custom', message: 'Duplicate map pack' });
});

export function locationCoordinates(location: { lat?: number | null; lng?: number | null } | null | undefined): [number, number] | null {
  if (!location || typeof location.lng !== 'number' || typeof location.lat !== 'number' || !Number.isFinite(location.lng) || !Number.isFinite(location.lat) || Math.abs(location.lng) > 180 || Math.abs(location.lat) > 90) return null;
  return [location.lng, location.lat];
}

export function selectMapPack(packs: MapManifest[], point: [number, number] | null) {
  return point ? packs.find(pack => inMapPack(point[0], point[1], pack.bounds)) ?? null : null;
}
const coordinate = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
export const roadPackSchema = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.object({
  type: z.literal('Feature'), id: z.number().int().positive(),
  properties: z.object({ highway: z.enum(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']) }),
  geometry: z.object({ type: z.literal('LineString'), coordinates: z.array(coordinate).min(2).max(10_000) }),
})).min(1).max(20_000) });

export function inMapPack(lng: number, lat: number, bounds: MapManifest['bounds']) {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= bounds[0] && lng <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
}

export async function verifyMapPack(manifest: MapManifest, bytes: ArrayBuffer) {
  if (bytes.byteLength !== manifest.bytes) throw new Error('Map pack size mismatch');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.sha256) throw new Error('Map pack integrity mismatch');
  const data = roadPackSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (data.features.length !== manifest.feature_count) throw new Error('Incomplete map pack');
  return data;
}
