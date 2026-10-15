import { NextRequest } from 'next/server';
import { sameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
const allowed = /^(health|version|distress\/extract|roads\/tile\/r\d{1,4}c\d{1,4}|reference\/(tsunami|disaster-map|place-opening\/\d{5})|replay\/(start|[a-zA-Z0-9_-]{1,80}(\/(pause|resume|next|reset|speed|explanation|distress(\/advice)?))?)|mock-live\/(start|cases|[a-zA-Z0-9_-]{1,80}(\/(next|explanation|distress(\/advice)?))?)|drill\/(start|[a-zA-Z0-9_-]{1,80}(\/next)?)|live\/(start|[a-zA-Z0-9_-]{1,80}(\/(refresh|routes\/search|location|profile|explanation|distress(\/advice)?))?))$/;
const judgePath = /^judge\/(start|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/next)$/i;
export function isAllowedApiProxyPath(path: string) { return allowed.test(path) || judgePath.test(path); }
export function isAllowedApiProxyRequest(path: string, method: string) {
  if (!isAllowedApiProxyPath(path) || !['GET', 'POST'].includes(method)) return false;
  if (path.startsWith('judge/')) return method === 'POST';
  if (path.startsWith('reference/')) return method === 'GET';
  if (/^roads\/tile\/r\d{1,4}c\d{1,4}$/.test(path)) return method === 'GET';
  // Post-Core explanations are generated on demand and never fetched with GET.
  if (/^(replay|live|mock-live)\/[a-zA-Z0-9_-]{1,80}\/explanation$/.test(path)) return method === 'POST';
  if (path === 'distress/extract' || /^(replay|live|mock-live)\/[a-zA-Z0-9_-]{1,80}\/distress(\/advice)?$/.test(path)) return method === 'POST';
  if (path === 'mock-live/cases') return method === 'GET';
  if (path === 'mock-live/start' || /^mock-live\/[a-zA-Z0-9_-]{1,80}\/next$/.test(path)) return method === 'POST';
  if (/^mock-live\/[a-zA-Z0-9_-]{1,80}$/.test(path)) return method === 'GET';
  if (path === 'drill/start' || /^drill\/[a-zA-Z0-9_-]{1,80}\/next$/.test(path)) return method === 'POST';
  if (/^drill\/[a-zA-Z0-9_-]{1,80}$/.test(path)) return method === 'GET';
  return !/^live\/[a-zA-Z0-9_-]{1,80}\/(location|profile)$/.test(path) || method === 'POST';
}
async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const suffix = path.join('/');
  if (!isAllowedApiProxyPath(suffix)) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!isAllowedApiProxyRequest(suffix, request.method)) {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || request.nextUrl.protocol.replace(':', '');
  if (request.method === 'POST' && !sameOrigin(request.headers.get('origin'), request.headers.get('host'), protocol)) {
    return Response.json({ error: 'Origin rejected' }, { status: 403 });
  }
  const body = request.method === 'POST' ? await request.text() : undefined;
  const limit = suffix === 'distress/extract' ? 1_450_000 : 8192;
  if (body && new TextEncoder().encode(body).length > limit) return Response.json({ error: 'Payload too large' }, { status: 413 });
  const backend = process.env.API_BASE_URL || 'http://127.0.0.1:8000';
  try {
    const response = await fetch(`${backend}/${suffix === 'health' || suffix === 'version' ? '' : 'api/'}${suffix}`, {
      method: request.method, headers: { 'Content-Type': 'application/json', ...(suffix.startsWith('roads/') ? { 'X-Road-Session': request.headers.get('x-road-session') || '' } : {}), ...((suffix.startsWith('drill/') || suffix.startsWith('mock-live/')) ? { 'X-Drill-Key': request.headers.get('x-drill-key') || '' } : {}) },
      body, cache: 'no-store', signal: AbortSignal.timeout(35000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': suffix.startsWith('roads/') && response.ok ? 'public, max-age=86400' : 'no-store' },
    });
  } catch {
    return Response.json({ error: 'Backend unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export { forward as GET, forward as POST };
