import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAllowedApiProxyPath, isAllowedApiProxyRequest } from '../app/api/[...path]/route';
import { judgeProjection, judgeRequest } from '../lib/judge-experience';
import { mockLiveResponseSchema } from '../lib/mock-live-envelope';

afterEach(() => vi.unstubAllGlobals());
describe('bounded public 311 entry', () => {
  it('proxies only POST start and UUID next; never exposes arbitrary mock operations', () => {
    const next = 'judge/12345678-1234-1234-1234-123456789abc/next';
    expect(isAllowedApiProxyRequest('judge/start', 'POST')).toBe(true);
    expect(isAllowedApiProxyRequest(next, 'POST')).toBe(true);
    for (const path of ['judge/start', next]) expect(isAllowedApiProxyRequest(path, 'GET')).toBe(false);
    for (const path of ['judge/cases', 'judge/abc/next', 'judge/start/next', 'judge/12345678-1234-1234-1234-123456789abc/distress']) {
      expect(isAllowedApiProxyPath(path)).toBe(false);
    }
  });
  it('validates the synthetic response and sends only language without a key', async () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/mock-live-311-final.json'), 'utf8'));
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture)));
    vi.stubGlobal('fetch', fetcher);
    const result = await judgeRequest('start', new AbortController().signal, 'ja');
    expect(result.historical?.case_id).toBe('tohoku-2011');
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[0]).toBe('/api/judge/start');
    expect(JSON.parse(init[1].body as string)).toEqual({language: 'ja'});
    expect(init[1].headers).not.toHaveProperty('X-Drill-Key');
    await judgeRequest('12345678-1234-1234-1234-123456789abc/next', new AbortController().signal);
    expect((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBeUndefined();
    fixture.snapshot.spatial_guidance.movement_authorized = true;
    await expect(judgeRequest('start', new AbortController().signal, 'ja')).rejects.toThrow();
  });
  it('retains local expiry gates and never promotes the blocked tsunami movement to an allowed action', () => {
    const fixture = mockLiveResponseSchema.parse(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/mock-live-311-final.json'), 'utf8')));
    const fresh = judgeProjection(fixture, Date.parse(fixture.snapshot.situation.updated_at), true);
    expect(fresh.actions.some(a => a.risk_level === 'HIGH')).toBe(false);
    expect(fresh.actions.some(a => a.category === 'NEXT')).toBe(true);
    const expired = judgeProjection(fixture, Date.parse(fresh.plan!.expires_at) + 1, true);
    expect(expired.planStatus).toBe('EXPIRED');
    expect(expired.actions).toEqual([]);
  });
});
