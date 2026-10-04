import { NextRequest } from 'next/server';
import { sameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
const allowed = /^(health|version|replay\/(start|[a-zA-Z0-9_-]{1,80}(\/(pause|resume|next|reset|speed))?))$/;
async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const suffix = path.join('/');
  if (!allowed.test(suffix)) return Response.json({ error: 'Not found' }, { status: 404 });
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || request.nextUrl.protocol.replace(':', '');
  if (request.method === 'POST' && !sameOrigin(request.headers.get('origin'), request.headers.get('host'), protocol)) {
    return Response.json({ error: 'Origin rejected' }, { status: 403 });
  }
  const body = request.method === 'POST' ? await request.text() : undefined;
  if (body && new TextEncoder().encode(body).length > 8192) return Response.json({ error: 'Payload too large' }, { status: 413 });
  const backend = process.env.API_BASE_URL || 'http://127.0.0.1:8000';
  try {
    const response = await fetch(`${backend}/${suffix === 'health' || suffix === 'version' ? '' : 'api/'}${suffix}`, {
      method: request.method, headers: { 'Content-Type': 'application/json' },
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
