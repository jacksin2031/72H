import type { Language } from './contracts';

/** Build a public app link that carries only the selected display language. */
export function publicHandoffUrl(origin: string, language: Language): string | null {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const labels = host.split('.');
    const reservedSuffixes = ['.localhost', '.local', '.test', '.example', '.invalid', '.internal', '.lan', '.onion', '.home.arpa'];
    const ipv4Literal = labels.length === 4 && labels.every(label => /^\d{1,3}$/.test(label));
    const validDnsName = labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      && !/^\d+$/.test(labels.at(-1) ?? '');
    if (url.protocol !== 'https:' || !validDnsName || ipv4Literal || url.username || url.password || url.port
      || host === 'localhost' || reservedSuffixes.some(suffix => host === suffix.slice(1) || host.endsWith(suffix))
      || !['ja', 'en', 'zh-TW'].includes(language)) return null;
    url.pathname = '/dashboard';
    url.search = `?language=${encodeURIComponent(language)}`;
    url.hash = '';
    return url.toString();
  } catch { return null; }
}
