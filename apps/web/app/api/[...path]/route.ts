import { NextRequest } from 'next/server';
import { sameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
const allowed = /^(health|version|replay\/(start|[a-zA-Z0-9_-]{1,80}(\/(pause|resume|next|reset|speed))?)|mock-live\/(start|cases|[a-zA-Z0-9_-]{1,80}(\/next)?)|drill\/(start|[a-zA-Z0-9_-]{1,80}(\/next)?)|live\/(start|[a-zA-Z0-9_-]{1,80}(\/(refresh|routes\/search|location|profile))?))$/;
export function isAllowedApiProxyPath(path: string) { return allowed.test(path); }
export function isAllowedApiProxyRequest(path: string, method: string) {
  if (!isAllowedApiProxyPath(path) || !['GET', 'POST'].includes(method)) return false;
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
  if (body && new TextEncoder().encode(body).length > 8192) return Response.json({ error: 'Payload too large' }, { status: 413 });
  const backend = process.env.API_BASE_URL || 'http://127.0.0.1:8000';
  try {
    const response = await fetch(`${backend}/${suffix === 'health' || suffix === 'version' ? '' : 'api/'}${suffix}`, {
      method: request.method, headers: { 'Content-Type': 'application/json', ...((suffix.startsWith('drill/') || suffix.startsWith('mock-live/')) ? { 'X-Drill-Key': request.headers.get('x-drill-key') || '' } : {}) },
      body, cache: 'no-store', signal: AbortSignal.timeout(35000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'Backend unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export { forward as GET, forward as POST };
