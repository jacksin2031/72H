import { describe, expect, it } from 'vitest';
import type { Language } from '../lib/contracts';
import { publicHandoffUrl } from '../lib/live-handoff';

describe('public LIVE handoff URL', () => {
  it('keeps only the public dashboard path and selected display language', () => {
    expect(publicHandoffUrl('https://72h.example.jp/private?session=secret&lat=35.6#token', 'zh-TW'))
      .toBe('https://72h.example.jp/dashboard?language=zh-TW');
  });

  it.each([
    ['unencrypted origin', 'http://72h.example.jp'],
    ['loopback host', 'https://localhost'],
    ['local-only DNS suffix', 'https://preview.example.local'],
    ['private numeric address', 'https://10.20.30.40:8443'],
  ])('rejects a %s', (_label, origin) => {
    expect(publicHandoffUrl(origin, 'en')).toBe(null);
  });

  it('rejects credentials, non-standard public ports, and unsupported languages', () => {
    expect(publicHandoffUrl('https://token:secret@72h.example.jp', 'en')).toBe(null);
    expect(publicHandoffUrl('https://72h.example.jp:8443', 'en')).toBe(null);
    expect(publicHandoffUrl('https://72h.example.jp', 'fr' as Language)).toBe(null);
  });
});
