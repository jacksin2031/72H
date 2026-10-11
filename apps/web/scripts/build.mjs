import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-map-worker.mjs';
import './prepare-area-worker.mjs';
import './prepare-hazard-pack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const staticRoot = join(root, '.next/static');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}
const urls = files(staticRoot).filter(file => !file.endsWith('.map')).map(file => '/_next/static/' + relative(staticRoot, file).split('\\').join('/'));
writeFileSync(join(root, 'public/precache-manifest.json'), JSON.stringify(urls));
const buildId = readFileSync(join(root, '.next/BUILD_ID'), 'utf8').trim();
writeFileSync(join(root, 'public/sw.js'), readFileSync(join(root, 'scripts/service-worker.js'), 'utf8').replace('__BUILD_ID__', buildId));
console.log(`Prepared ${urls.length} static assets for offline shell.`);
