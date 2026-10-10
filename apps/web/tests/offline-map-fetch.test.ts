import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const origin = 'https://preview.example.test';
const script = readFileSync(new URL('../scripts/service-worker.js', import.meta.url), 'utf8');

function harness(cached?: Response) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const fetch = vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
  const match = vi.fn().mockResolvedValue(cached);
  runInNewContext(script, { URL, Response, fetch,
    self: { location: { origin }, addEventListener(name: string, listener: (event: unknown) => void) { listeners[name] = listener; } },
    caches: { match },
  });
  const request = (path: string, headers?: HeadersInit) => {
    const respondWith = vi.fn();
    const event = { request: new Request(path.startsWith('https:') ? path : origin + path, { headers }), respondWith, waitUntil: vi.fn() };
    listeners.fetch(event);
    return respondWith;
  };
  return { request, fetch, match };
}

describe('offline map pack fetch handling', () => {
  it('serves a catalog-installed road pack from cache after offline reload', async () => {
    const geojson = '{"type":"FeatureCollection","features":[]}';
    const app = harness(new Response(geojson));
    const respond = app.request('/maps/tokyo-central.geojson');
    expect(respond).toHaveBeenCalledOnce();
    const response = await respond.mock.calls[0][0] as Response;
    expect(await response.text()).toBe(geojson);
    expect(app.fetch).not.toHaveBeenCalled();
  });

  it('does not invent map data when an uncached pack cannot reach the network', async () => {
    const app = harness();
    const respond = app.request('/maps/not-downloaded.geojson');
    await expect(respond.mock.calls[0][0]).rejects.toThrow('Network unavailable');
  });

  it('keeps authenticated, API, cross-origin and query requests outside the cache handler', () => {
    const app = harness(new Response('cached'));
    expect(app.request('/maps/tokyo-central.geojson', { Authorization: 'Bearer test' })).not.toHaveBeenCalled();
    expect(app.request('/api/live/session')).not.toHaveBeenCalled();
    expect(app.request('https://other.example.test/maps/tokyo-central.geojson')).not.toHaveBeenCalled();
    expect(app.request('/maps/tokyo-central.geojson?private=1')).not.toHaveBeenCalled();
    expect(app.match).not.toHaveBeenCalled();
  });
});
