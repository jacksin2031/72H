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
    caches: { match, open:vi.fn().mockResolvedValue({match,put:vi.fn()}) },
  });
  const request = (path: string, headers?: HeadersInit, cache:RequestCache='default') => {
    const respondWith = vi.fn();
    const event = { request: new Request(path.startsWith('https:') ? path : origin + path, { headers,cache }), respondWith, waitUntil: vi.fn() };
    listeners.fetch(event);
    return respondWith;
  };
  return { request, fetch, match };
}

describe('offline map pack fetch handling', () => {
  it('restores pinned public walking graphs offline without caching GPS queries or model responses',async()=>{
    const app=harness(new Response('pinned-road-reference'));
    const response=app.request('/roads/ishinomaki-central-v1/graph.json',undefined,'no-cache');
    expect(response).toHaveBeenCalledOnce();expect(await (await response.mock.calls[0][0]).text()).toBe('pinned-road-reference');
    expect(app.request('/roads/ishinomaki-central-v1/graph.json?lat=38.4')).not.toHaveBeenCalled();
    expect(app.request('/api/live/session/explanation')).not.toHaveBeenCalled();
  });
  it('revalidates a public pack requested with no-cache after a pin/manifest upgrade',async()=>{
    const app=harness(new Response('old-manifest'));app.fetch.mockResolvedValue(new Response('new-manifest'));
    const respond=app.request('/hazards/jma-forecast-lines-v1/manifest.json',undefined,'no-cache');
    expect(await (await respond.mock.calls[0][0]).text()).toBe('new-manifest');expect(app.fetch).toHaveBeenCalledOnce();
  });
  it('retains the public cached pack on offline revalidation; the client still checks its pinned hash',async()=>{
    const app=harness(new Response('old-reference'));
    const respond=app.request('/hazards/jma-forecast-lines-v1/manifest.json',undefined,'no-cache');
    expect(await (await respond.mock.calls[0][0]).text()).toBe('old-reference');
  });
  it('migrates public packs before shell cleanup and retains them across later offline upgrades',async()=>{
    const listeners:Record<string,(event:unknown)=>void>={};
    const stores=new Map<string,Map<string,{request:Request,response:Response}>>();
    const packPath=origin+'/hazards/miyagi-ishinomaki-v1/manifest.json';
    stores.set('72h-shell-old',new Map([
      [packPath,{request:new Request(packPath),response:new Response('verified-pack')}],
      [origin+'/api/reference/tsunami',{request:new Request(origin+'/api/reference/tsunami'),response:new Response('private-api')}],
      [packPath+'?gps=1',{request:new Request(packPath+'?gps=1'),response:new Response('private-query')}],
    ]));
    const fetch=vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
    const caches={
      keys:async()=>[...stores.keys()],delete:async(key:string)=>stores.delete(key),
      open:async(key:string)=>{
        if(!stores.has(key))stores.set(key,new Map());
        const store=stores.get(key)!;
        return {keys:async()=>[...store.values()].map(x=>x.request),
          match:async(request:Request)=>store.get(request.url)?.response.clone(),
          put:async(request:Request,response:Response)=>{store.set(request.url,{request,response:response.clone()});}};
      },
    };
    runInNewContext(script,{URL,Response,fetch,caches,self:{location:{origin},clients:{claim:vi.fn()},
      addEventListener(name:string,listener:(event:unknown)=>void){listeners[name]=listener;}}});
    for(const oldShell of ['72h-shell-old','72h-shell-another-upgrade']){
      if(!stores.has(oldShell))stores.set(oldShell,new Map());
      let activation:Promise<unknown>|undefined;
      listeners.activate({waitUntil:(p:Promise<unknown>)=>{activation=p;}});await activation;
      expect(stores.has(oldShell)).toBe(false);
      expect([...stores.get('72h-hazards-v1')!.keys()]).toEqual([packPath]);
      const respondWith=vi.fn();
      listeners.fetch({request:new Request(packPath),respondWith,waitUntil:vi.fn()});
      expect(await (await respondWith.mock.calls[0][0]).text()).toBe('verified-pack');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('restores downloaded public hazard data but never caches live tsunami API responses',async()=>{
    const app=harness(new Response('{"test":"public reference only"}'));
    const respond=app.request('/hazards/ishinomaki/inundation.geojson');
    expect(respond).toHaveBeenCalledOnce();
    expect(await (await respond.mock.calls[0][0]).text()).toContain('public reference only');
    expect(app.request('/api/reference/tsunami')).not.toHaveBeenCalled();
    expect(app.request('/hazards/ishinomaki/places.json?gps=1')).not.toHaveBeenCalled();
    expect(app.request('/hazards/ishinomaki/places.json',{Authorization:'Bearer test'})).not.toHaveBeenCalled();
  });
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
