/**
 * Key-page discovery, in trust order (2026-10-15; was sitemap-first, M2.1 §6):
 *   1. links on the entry page (same-origin)  2. sitemap.xml entries  3. common-path fallback
 * Bounded to a small budget; same-origin only (never third-party).
 */
import { isTechnicalUrl } from '@bb/application';
import { isSameOrigin } from './url';

export const COMMON_PATHS = ['/about', '/services', '/products', '/pricing', '/blog', '/contact'];
export const DEFAULT_PAGE_BUDGET = 10;

export function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) { const loc = m[1]; if (loc) urls.push(loc.trim()); }
  return urls;
}

/** Extract same-origin href links from HTML (nav + body); dedupe, drop fragments/mailto/tel. */
export function extractLinks(entryUrl: string, html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]?.trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    let abs: string;
    try { abs = new URL(href, entryUrl).toString(); } catch { continue; }
    const clean = abs.split('#')[0];
    if (!clean || !isSameOrigin(clean, entryUrl)) continue;
    if (!seen.has(clean)) { seen.add(clean); out.push(clean); }
  }
  return out;
}

export function commonPathUrls(origin: string): string[] {
  return COMMON_PATHS.map((p) => `${origin}${p}`);
}

export type PageDiscovery = 'entry' | 'link' | 'sitemap' | 'common';
export interface DiscoveredPage { url: string; via: PageDiscovery }

/**
 * Compose the bounded key-page set, in TRUST order (2026-10-15): the entry page, then the pages it links to (what the
 * business actually shows its visitors), then sitemap-only pages (possibly stale or orphaned), then common paths.
 * Sitemap XML documents (a sitemap index lists sub-sitemaps) and technical pages (maintenance, cart, checkout, account)
 * are never read as business pages. Deduped, same-origin, capped to budget. Each page says how it was found.
 */
export function discoverKeyPagesWithSource(
  args: { entryUrl: string; origin: string; entryHtml: string; sitemapXml?: string | null },
  budget: number = DEFAULT_PAGE_BUDGET,
): DiscoveredPage[] {
  const ordered: DiscoveredPage[] = [{ url: args.entryUrl, via: 'entry' }];
  const push = (u: string, via: PageDiscovery) => {
    const clean = u.split('#')[0];
    if (clean && isSameOrigin(clean, args.entryUrl) && !isTechnicalUrl(clean)) ordered.push({ url: clean, via });
  };
  extractLinks(args.entryUrl, args.entryHtml).forEach((u) => push(u, 'link'));
  if (args.sitemapXml) parseSitemapUrls(args.sitemapXml).forEach((u) => push(u, 'sitemap'));
  commonPathUrls(args.origin).forEach((u) => push(u, 'common'));

  const deduped: DiscoveredPage[] = [];
  const seen = new Set<string>();
  for (const p of ordered) {
    const key = p.url.replace(/\/$/, '');
    if (!seen.has(key)) { seen.add(key); deduped.push(p); }
    if (deduped.length >= budget) break;
  }
  return deduped;
}

/** The URLs only (callers that do not need provenance). */
export function discoverKeyPages(
  args: { entryUrl: string; origin: string; entryHtml: string; sitemapXml?: string | null },
  budget: number = DEFAULT_PAGE_BUDGET,
): string[] {
  return discoverKeyPagesWithSource(args, budget).map((p) => p.url);
}
