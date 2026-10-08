import { areaAssetIdentity } from './area-asset-identity';
import { areaPath, unavailableArea, validAreaFix, type AreaEntry, type AreaFix, type AreaResolution } from './area-geometry';
export type { AreaEntry, AreaResolution } from './area-geometry';

let catalogPromise: Promise<AreaEntry[]> | undefined;
export async function loadAreaCatalog(): Promise<AreaEntry[]> {
  catalogPromise ||= (async () => {
    const response = await fetch('/areas/catalog.json', { credentials: 'omit', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Area catalog unavailable');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== areaAssetIdentity.catalog_bytes) throw new Error('Invalid area catalog size');
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (sha !== areaAssetIdentity.catalog_sha256) throw new Error('Invalid area catalog hash');
    const catalog: AreaEntry[] = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(catalog) || catalog.length > 10000 || new Set(catalog.map(area => area.id)).size !== catalog.length
      || catalog.some(area => !area || typeof area.label !== 'string' || !/^JP(?:-\d{2}|-MUNI-\d{5})?$/.test(area.id)
        || (area.parent_id !== null && typeof area.parent_id !== 'string') || !areaPath(area.id, catalog).length)) throw new Error('Invalid area hierarchy');
    return catalog;
  })().catch(error => { catalogPromise = undefined; throw error; });
  return catalogPromise;
}

/** A separate worker protects the consumer thread and is always stopped after one bounded lookup. */
export async function resolveDeviceArea(fix: AreaFix): Promise<AreaResolution> {
  if (!validAreaFix(fix) || typeof Worker === 'undefined') return unavailableArea();
  return new Promise(resolve => {
    let worker: Worker;
    try { worker = new Worker('/areas/worker.mjs', { type: 'module' }); }
    catch { resolve(unavailableArea()); return; }
    const finish = (result: AreaResolution) => { clearTimeout(timer); worker.terminate(); resolve(result); };
    const timer = setTimeout(() => finish(unavailableArea()), 30000);
    worker.onerror = () => finish(unavailableArea());
    worker.onmessage = async event => {
      const result = event.data as AreaResolution;
      if (!result || !['RESOLVED', 'AMBIGUOUS', 'UNAVAILABLE', 'OUTSIDE'].includes(result.status)
        || !Array.isArray(result.area_ids) || typeof result.label !== 'string') { finish(unavailableArea()); return; }
      try {
        if (result.area_ids.length && JSON.stringify(areaPath(result.area_ids[0], await loadAreaCatalog())) !== JSON.stringify(result.area_ids)) { finish(unavailableArea()); return; }
        finish(result);
      } catch { finish(unavailableArea()); }
    };
    worker.postMessage(fix);
  });
}
