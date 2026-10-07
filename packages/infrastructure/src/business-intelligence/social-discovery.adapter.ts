import { parse } from 'node-html-parser';
import type { ISocialDiscoveryPort, DiscoveredProfileInput } from '@bb/application';
import { normalizeUrl } from '../connectors/website/url';
import { fetchDocument } from '../connectors/website/fetcher';

/**
 * Discover-before-asking: find obvious outbound public business profiles linked from the site
 * (header/footer/nav/social icons). No scraping of protected content, no Meta approval — this
 * only records that a public profile was DISCOVERED (ownership confirmation is separate).
 */
const PLATFORMS: { platform: string; test: (host: string) => boolean }[] = [
  { platform: 'instagram', test: (h) => h.includes('instagram.com') },
  { platform: 'facebook', test: (h) => h.includes('facebook.com') || h.endsWith('fb.com') },
  { platform: 'linkedin', test: (h) => h.includes('linkedin.com') },
  { platform: 'youtube', test: (h) => h.includes('youtube.com') || h.includes('youtu.be') },
  { platform: 'tiktok', test: (h) => h.includes('tiktok.com') },
  { platform: 'google_business', test: (h) => h.includes('g.page') || h.includes('maps.google') || h.includes('business.google') },
];

function classify(href: string): string | null {
  let host = '';
  try {
    host = new URL(href).host.toLowerCase();
  } catch {
    return null;
  }
  for (const p of PLATFORMS) if (p.test(host)) return p.platform;
  return null;
}

export class SocialDiscoveryAdapter implements ISocialDiscoveryPort {
  async discover(url: string): Promise<DiscoveredProfileInput[]> {
    const norm = normalizeUrl(url);
    if (!norm.ok) return [];
    const doc = await fetchDocument(norm.url, { timeoutMs: 6000 });
    if (!doc.ok || !doc.body) return [];

    const ownHost = norm.host.replace(/^www\./, '');
    const root = parse(doc.body);
    const out = new Map<string, DiscoveredProfileInput>();

    for (const a of root.querySelectorAll('a')) {
      const href = (a.getAttribute('href') ?? '').trim();
      if (!href.startsWith('http')) continue;
      const platform = classify(href);
      if (!platform) continue;
      let host = '';
      try {
        host = new URL(href).host.replace(/^www\./, '');
      } catch {
        continue;
      }
      if (host === ownHost) continue; // not an outbound profile
      const clean = (href.split('?')[0] ?? href).replace(/\/$/, '');
      if (/\/(sharer|share|intent|dialog|plugins)\b/i.test(clean)) continue; // share widgets, not profiles
      if (!out.has(clean)) out.set(clean, { platform, url: clean, discoveredFromUrl: norm.url });
    }
    return Array.from(out.values()).slice(0, 12);
  }
}
