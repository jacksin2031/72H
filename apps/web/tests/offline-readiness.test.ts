import { describe, expect, it } from 'vitest';
import { requiredCachedPageAssets } from '../lib/offline-readiness';

describe('cached shell readiness inventory', () => {
  it('identifies same-origin Next scripts and styles but ignores remote or unrelated resources', () => {
    const html = '<script src="/_next/static/chunks/runtime.js"></script><link href="/_next/static/css/app.css" rel="stylesheet"><script src="https://cdn.example/app.js"></script><img src="/icon.svg">';
    expect(requiredCachedPageAssets(html, 'https://72h.example')).toEqual([
      'https://72h.example/_next/static/chunks/runtime.js', 'https://72h.example/_next/static/css/app.css',
    ]);
  });
});
