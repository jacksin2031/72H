/** Controlled local browser acceptance input; never a live source or production endpoint. */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web');
const requireWeb = createRequire(join(web, 'package.json'));
const ts = requireWeb('typescript');
const output = join(root, '.work/p1-1/browser-fixtures');
for (const file of ['lib/contracts', 'tests/fixtures', 'tests/live-fixtures']) {
  const target = join(output, file + '.cjs');
  mkdirSync(dirname(target), { recursive: true });
  let code = ts.transpileModule(readFileSync(join(web, file + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  code = code.replace(/require\("(\.\.?\/[^"\n]+)"\)/g, 'require("$1.cjs")')
    .replace('require("zod")', `require(${JSON.stringify(requireWeb.resolve('zod'))})`);
  writeFileSync(target, code);
}
const requireFixture = createRequire(join(output, 'loader.cjs'));
const { movementLiveSnapshot, LIVE_NOW } = requireFixture('./tests/live-fixtures.cjs');
const { liveSnapshotSchema } = requireFixture('./lib/contracts.cjs');
const delta = Date.now() - LIVE_NOW;
function shift(value) {
  if (Array.isArray(value)) return value.map(shift);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v)]));
  if (typeof value !== 'string') return value;
  if (/^2026-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))) return new Date(Date.parse(value) + delta).toISOString();
  return value.replaceAll('JP-13-SHIBUYA', 'JP-MUNI-13113').replaceAll('JP-13-ASAKUSA', 'JP-MUNI-13106');
}
const movement = shift(movementLiveSnapshot());
movement.destinations = movement.destinations.slice(0, 1);
movement.evidence[0].claims = movement.evidence[0].claims.slice(0, 1);
movement.profile.current_location.observed_at = new Date(Date.now() - 5000).toISOString();
movement.profile.current_location.source = 'GPS';
movement.profile.self_reported_safety_status = 'UNKNOWN';
const variants = { movement };
for (const [name, kind] of [['monitor', 'MONITOR'], ['shelter', 'SHELTER_IN_PLACE']]) {
  const fixture = structuredClone(movement);
  fixture.spatial_guidance = { ...fixture.spatial_guidance, current_action_kind: kind,
    movement_authorized: false, map_mount_eligible: false, destination: null, route: null,
    gate_reasons: ['CONTROLLED_LOCAL_BROWSER_FIXTURE'] };
  fixture.plan_actions[0] = { ...fixture.plan_actions[0], risk_level: 'LOW', intent_id: 'protect_and_monitor',
    text: 'Protect yourself where you are and monitor verified updates.', evidence_ids: [] };
  variants[name] = fixture;
}
for (const [name, fixture] of Object.entries(variants)) {
  liveSnapshotSchema.parse(fixture);
  writeFileSync(join(output, name + '.json'), JSON.stringify(fixture));
}
writeFileSync(join(output, 'README.txt'), 'CONTROLLED TEST INPUT ONLY. Existing typed movement fixture, timestamps shifted to capture time. Not official observations, live integration, or movement permission for any person.\n');
console.log('PASS: movement / monitor / shelter local browser fixtures validate against LiveSnapshot.');
