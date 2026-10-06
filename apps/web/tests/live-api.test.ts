import { describe, expect, it } from 'vitest';
import { isMissingLiveSessionError, LiveApiError } from '../lib/live-api';

describe('live session loss handling', () => {
  it('recognizes an evicted server session separately from network failures', () => {
    expect(isMissingLiveSessionError(new LiveApiError(404))).toBe(true);
    expect(isMissingLiveSessionError(new LiveApiError(503))).toBe(false);
    expect(isMissingLiveSessionError(new TypeError('network'))).toBe(false);
  });
});
