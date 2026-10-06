/** Static JS/CSS URLs needed by a cached page; remote and non-Next resources are ignored. */
export function requiredCachedPageAssets(html: string, origin: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    try {
      const url = new URL(match[1], origin);
      if (url.origin === origin && url.pathname.startsWith('/_next/static/')
        && (/\.js$|\.css$/i.test(url.pathname))) urls.add(`${url.origin}${url.pathname}`);
    } catch { /* Malformed attributes cannot qualify an asset as cached. */ }
  }
  return [...urls];
}
