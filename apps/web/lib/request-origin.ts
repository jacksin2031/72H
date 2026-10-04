/** Compare against the public Host, because Next may normalize nextUrl to localhost. */
export function sameOrigin(origin: string | null, host: string | null, protocol: string) {
  if (!origin) return true; // Non-browser CLI clients have no Origin.
  if (!host || !['http', 'https'].includes(protocol)) return false;
  try {
    const supplied = new URL(origin);
    const expected = new URL(`${protocol}://${host}`);
    return supplied.origin === origin && supplied.origin === expected.origin;
  } catch { return false; }
}
