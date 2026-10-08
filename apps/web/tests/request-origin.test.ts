import { expect, it } from 'vitest';
import { sameOrigin } from '../lib/request-origin';
import { isAllowedApiProxyPath, isAllowedApiProxyRequest } from '../app/api/[...path]/route';

it('accepts the public browser origin for localhost and Cloud Run', () => {
  expect(sameOrigin('http://127.0.0.1:3000', '127.0.0.1:3000', 'http')).toBe(true);
  expect(sameOrigin('https://72h.example.run.app', '72h.example.run.app', 'https')).toBe(true);
});
it('rejects foreign origins, alternate ports, null and malformed origins', () => {
  for (const origin of ['https://attacker.example', 'http://127.0.0.1:3001', 'null', 'http://127.0.0.1:3000/other']) {
    expect(sameOrigin(origin, '127.0.0.1:3000', 'http')).toBe(false);
  }
});

it('allows only the session location update path through the API proxy allowlist', () => {
  expect(isAllowedApiProxyPath('live/session_1/location')).toBe(true);
  expect(isAllowedApiProxyPath('live/start')).toBe(true);
  expect(isAllowedApiProxyPath('live/session_1/refresh')).toBe(true);
  expect(isAllowedApiProxyPath('live//location')).toBe(false);
  expect(isAllowedApiProxyPath('live/session_1/routes/location')).toBe(false);
  expect(isAllowedApiProxyPath('live/session_1/location/refresh')).toBe(false);
  expect(isAllowedApiProxyRequest('live/session_1/location', 'POST')).toBe(true);
  expect(isAllowedApiProxyRequest('live/session_1/location', 'GET')).toBe(false);
  expect(isAllowedApiProxyRequest('live/session_1/refresh', 'POST')).toBe(true);
  expect(isAllowedApiProxyPath('live/session_1/profile')).toBe(true);
  expect(isAllowedApiProxyPath('live/session_1/profile/update')).toBe(false);
  expect(isAllowedApiProxyRequest('live/session_1/profile', 'POST')).toBe(true);
  expect(isAllowedApiProxyRequest('live/session_1/profile', 'GET')).toBe(false);
});
