import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  static workers: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  sent: unknown;
  constructor() { FakeWorker.workers.push(this); }
  postMessage(fix: unknown) { this.sent = fix; }
  terminate() { this.terminated = true; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); FakeWorker.workers = []; });
describe('local resolver worker boundary', () => {
  it('returns an unavailable area for unsupported workers and invalid fixes', async () => {
    vi.stubGlobal('Worker', undefined);
    const { resolveDeviceArea } = await import('../lib/area-resolution');
    expect((await resolveDeviceArea({ latitude: 35, longitude: 139, accuracy_m: 10 })).status).toBe('UNAVAILABLE');
    expect((await resolveDeviceArea({ latitude: 999, longitude: 139, accuracy_m: 10 })).area_ids).toEqual([]);
  });
  it('terminates failed and timed-out workers without fabricating a prefecture', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker);
    const { resolveDeviceArea } = await import('../lib/area-resolution');
    const pending = resolveDeviceArea({ latitude: 35, longitude: 139, accuracy_m: 10 });
    FakeWorker.workers[0].onerror!();
    expect((await pending).area_ids).toEqual([]); expect(FakeWorker.workers[0].terminated).toBe(true);
    const timed = resolveDeviceArea({ latitude: 35, longitude: 139, accuracy_m: 10 });
    await vi.advanceTimersByTimeAsync(30000);
    expect((await timed).status).toBe('UNAVAILABLE'); expect(FakeWorker.workers[1].terminated).toBe(true);
  });
  it('accepts only complete pinned catalog ancestry and closes the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker); vi.stubGlobal('crypto', webcrypto);
    const catalog = readFileSync(resolve(__dirname, '../public/areas/catalog.json'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(catalog)));
    const { resolveDeviceArea } = await import('../lib/area-resolution');
    const pending = resolveDeviceArea({ latitude: 35.6598, longitude: 139.7005, accuracy_m: 20 });
    await FakeWorker.workers[0].onmessage!({ data: { status: 'RESOLVED', area_ids: ['JP-MUNI-13113', 'JP-13', 'JP'], label: '東京都 渋谷区' } });
    expect((await pending).area_ids[0]).toBe('JP-MUNI-13113'); expect(FakeWorker.workers[0].terminated).toBe(true);
    const forged = resolveDeviceArea({ latitude: 35.6598, longitude: 139.7005, accuracy_m: 20 });
    await FakeWorker.workers[1].onmessage!({ data: { status: 'RESOLVED', area_ids: ['JP-MUNI-13113', 'JP'], label: 'Tokyo' } });
    expect((await forged).status).toBe('UNAVAILABLE');
  });
  it('rejects corrupted catalog bytes', async () => {
    vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')));
    const { loadAreaCatalog } = await import('../lib/area-resolution');
    await expect(loadAreaCatalog()).rejects.toThrow('Invalid area catalog size');
  });
});
