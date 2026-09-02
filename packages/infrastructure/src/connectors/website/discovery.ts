/**
 * Key-page discovery, in priority order (M2.1 §6):
 *   1. sitemap.xml  2. primary nav links (same-origin)  3. common-path fallback
 * Bounded to a small budget; same-origin only (never third-party).
 */
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

/**
 * Compose the bounded key-page set. Entry first, then sitemap, then nav, then common
 * paths; deduped, same-origin, capped to budget.
 */
export function discoverKeyPages(
  args: { entryUrl: string; origin: string; entryHtml: string; sitemapXml?: string | null },
  budget: number = DEFAULT_PAGE_BUDGET,
): string[] {
  const ordered: string[] = [args.entryUrl];
  const push = (u: string) => {
    const clean = u.split('#')[0];
    if (clean && isSameOrigin(clean, args.entryUrl)) ordered.push(clean);
  };

  if (args.sitemapXml) parseSitemapUrls(args.sitemapXml).forEach(push);
  extractLinks(args.entryUrl, args.entryHtml).forEach(push);
  commonPathUrls(args.origin).forEach(push);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const u of ordered) {
    const key = u.replace(/\/$/, '');
    if (!seen.has(key)) { seen.add(key); deduped.push(u); }
    if (deduped.length >= budget) break;
  }
  return deduped;
}
