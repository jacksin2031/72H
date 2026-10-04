import { expect, it } from 'vitest';
import { sameOrigin } from '../lib/request-origin';

it('accepts the public browser origin for localhost and Cloud Run', () => {
  expect(sameOrigin('http://127.0.0.1:3000', '127.0.0.1:3000', 'http')).toBe(true);
  expect(sameOrigin('https://72h.example.run.app', '72h.example.run.app', 'https')).toBe(true);
});
it('rejects foreign origins, alternate ports, null and malformed origins', () => {
  for (const origin of ['https://attacker.example', 'http://127.0.0.1:3001', 'null', 'http://127.0.0.1:3000/other']) {
    expect(sameOrigin(origin, '127.0.0.1:3000', 'http')).toBe(false);
  }
});
