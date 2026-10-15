import { describe, expect, it } from 'vitest';
import { isAllowedApiProxyPath, isAllowedApiProxyRequest } from '../app/api/[...path]/route';

describe('api proxy road tiles', () => {
  it('allows only GET road tiles by grid id', () => {
    expect(isAllowedApiProxyPath('roads/tile/r1920c5651')).toBe(true);
    for (const p of ['roads/tile/38.4,141.2', 'roads/tile/r1920c5651/x', 'roads/tile/r1c', 'roads/tile/r12345c1']) {
      expect(isAllowedApiProxyPath(p)).toBe(false);
    }
    expect(isAllowedApiProxyRequest('roads/tile/r1920c5651', 'GET')).toBe(true);
    expect(isAllowedApiProxyRequest('roads/tile/r1920c5651', 'POST')).toBe(false);
  });
});
