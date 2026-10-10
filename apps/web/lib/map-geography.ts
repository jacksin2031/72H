import { z } from 'zod';

export const mapGeographyBounds = [139.68, 35.64, 139.82, 35.74] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceShardSchema = z.object({
  asset: z.string().regex(/^\/areas\/n03-2026-[a-f0-9]{64}\.json\.gz$/),
  sha256: sha256Schema,
  bytes: z.number().int().positive().max(8_000_000),
}).strict();

export const mapGeographyManifestSchema = z.object({
  id: z.literal('tokyo-central-geography-v1'),
  version: z.literal(1),
  bounds: z.tuple([
    z.literal(mapGeographyBounds[0]), z.literal(mapGeographyBounds[1]),
    z.literal(mapGeographyBounds[2]), z.literal(mapGeographyBounds[3]),
  ]),
  source: z.literal('国土交通省 国土数値情報（行政区域）2026年版'),
  source_url: z.literal('https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html'),
  source_dataset: z.literal('N03-20260101'),
  source_archive_sha256: sha256Schema,
  source_manifest: z.literal('/areas/manifest.json'),
  source_manifest_sha256: sha256Schema,
  source_catalog: z.literal('/areas/catalog.json'),
  source_catalog_sha256: sha256Schema,
  source_catalog_bytes: z.number().int().positive().max(1_000_000),
  source_shards: z.array(sourceShardSchema).min(1).max(8),
  source_candidate_count: z.number().int().positive().max(512),
  source_feature_count: z.number().int().positive().max(512),
  source_feature_ids: z.array(z.number().int().nonnegative().max(1_000_000)).min(1).max(512),
  source_area_ids: z.array(z.string().regex(/^JP-MUNI-\d{5}$/)).min(1).max(128),
  source_provisional_boundary_area_ids: z.array(z.string().regex(/^JP-MUNI-\d{5}$/)).max(128),
  asset: z.literal('/maps/tokyo-central-geography.geojson'),
  bytes: z.number().int().positive().max(8_000_000),
  sha256: sha256Schema,
  feature_count: z.literal(2),
  license: z.literal('CC BY 4.0'),
  license_url: z.literal('https://creativecommons.org/licenses/by/4.0/'),
  attribution: z.literal('国土交通省 国土数値情報（行政区域）2026年版を加工'),
  provenance: z.string().min(1).max(2_000),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.source_feature_count !== manifest.source_feature_ids.length) {
    ctx.addIssue({ code: 'custom', path: ['source_feature_count'], message: 'N03 feature count does not match feature IDs' });
  }
  if (new Set(manifest.source_feature_ids).size !== manifest.source_feature_ids.length) {
    ctx.addIssue({ code: 'custom', path: ['source_feature_ids'], message: 'Duplicate N03 feature ID' });
  }
  if (new Set(manifest.source_area_ids).size !== manifest.source_area_ids.length) {
    ctx.addIssue({ code: 'custom', path: ['source_area_ids'], message: 'Duplicate N03 area ID' });
  }
  if (new Set(manifest.source_provisional_boundary_area_ids).size !== manifest.source_provisional_boundary_area_ids.length
      || manifest.source_provisional_boundary_area_ids.some(id => !manifest.source_area_ids.includes(id))) {
    ctx.addIssue({ code: 'custom', path: ['source_provisional_boundary_area_ids'], message: 'Invalid N03 provisional boundary area IDs' });
  }
  if (new Set(manifest.source_shards.map(shard => shard.asset)).size !== manifest.source_shards.length) {
    ctx.addIssue({ code: 'custom', path: ['source_shards'], message: 'Duplicate N03 source shard' });
  }
  if (manifest.source_candidate_count < manifest.source_feature_count) {
    ctx.addIssue({ code: 'custom', path: ['source_candidate_count'], message: 'Candidate count is smaller than contributors' });
  }
});

export type MapGeographyManifest = z.infer<typeof mapGeographyManifestSchema>;

const coordinate = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const linearRing = z.array(coordinate).min(4).max(100_000).superRefine((ring, ctx) => {
  const first = ring[0];
  const last = ring.at(-1);
  if (!last || first[0] !== last[0] || first[1] !== last[1]) {
    ctx.addIssue({ code: 'custom', message: 'Polygon rings must be closed' });
  }
});
const polygonCoordinates = z.array(linearRing).min(1).max(256);
const polygonGeometry = z.object({ type: z.literal('Polygon'), coordinates: polygonCoordinates }).strict();
const multiPolygonGeometry = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(polygonCoordinates).min(1).max(256),
}).strict();
const landGeometry = z.union([polygonGeometry, multiPolygonGeometry]);
const lineCoordinates = z.array(coordinate).min(2).max(100_000);
const multiLineStringGeometry = z.object({
  type: z.literal('MultiLineString'),
  coordinates: z.array(lineCoordinates).min(1).max(10_000),
}).strict();

const landFeature = z.object({
  type: z.literal('Feature'),
  properties: z.object({ kind: z.literal('land') }).strict(),
  geometry: landGeometry,
}).strict();
const coastlineFeature = z.object({
  type: z.literal('Feature'),
  properties: z.object({ kind: z.literal('coastline') }).strict(),
  geometry: multiLineStringGeometry,
}).strict();

export const mapGeographySchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.union([landFeature, coastlineFeature])).length(2),
}).strict().superRefine((collection, ctx) => {
  if (collection.features.filter(feature => feature.properties.kind === 'land').length !== 1
      || collection.features.filter(feature => feature.properties.kind === 'coastline').length !== 1) {
    ctx.addIssue({ code: 'custom', path: ['features'], message: 'Expected one land and one coastline feature' });
  }

  let positionCount = 0;
  for (const [featureIndex, feature] of collection.features.entries()) {
    const coordinates = feature.geometry.coordinates;
    const visit = (value: unknown) => {
      if (!Array.isArray(value)) return;
      if (value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        positionCount += 1;
        if (value[0] < mapGeographyBounds[0] || value[0] > mapGeographyBounds[2]
            || value[1] < mapGeographyBounds[1] || value[1] > mapGeographyBounds[3]) {
          ctx.addIssue({ code: 'custom', path: ['features', featureIndex, 'geometry', 'coordinates'], message: 'Coordinate is outside manifest bounds' });
        }
        return;
      }
      for (const child of value) visit(child);
    };
    visit(coordinates);
  }
  if (positionCount > 250_000) {
    ctx.addIssue({ code: 'custom', path: ['features'], message: 'Geography coordinate budget exceeded' });
  }
});

export type MapGeography = z.infer<typeof mapGeographySchema>;

export async function verifyMapGeography(manifestInput: unknown, bytes: ArrayBuffer): Promise<MapGeography> {
  const manifest = mapGeographyManifestSchema.parse(manifestInput);
  if (bytes.byteLength !== manifest.bytes) throw new Error('Map geography size mismatch');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.sha256) throw new Error('Map geography integrity mismatch');

  const data = mapGeographySchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (data.features.length !== manifest.feature_count) throw new Error('Incomplete map geography pack');
  return data;
}
