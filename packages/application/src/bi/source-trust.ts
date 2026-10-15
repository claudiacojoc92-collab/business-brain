import type { PageObservation } from './contracts';

/**
 * Which sources may carry a strategic claim (2026-10-15). The website is ONE evidence source, not the business, and some
 * of what a crawl returns is not business evidence at all:
 *  - technical pages: sitemap XML, maintenance / test / staging pages, cart, checkout, account and login pages;
 *  - pages found ONLY in a sitemap (nothing on the homepage links to them): possibly stale or orphaned.
 * A claim that rests only on such sources is "something I found but don't trust yet", never a business fact.
 * Founder-supplied material and Instagram are trusted as what they are (declared / observed).
 */

// A whole path segment, so "/test-postural" or "/demo-class" (real offers) never count as technical.
const TECHNICAL_URL = /(\.xml(?:$|[?#])|\/(?:wp-admin|wp-json|wp-login|feed|maintenance|mentenanta|mentenanță|under-construction|coming-soon|test|testing|staging|sample-page|cart|cos|cosul|checkout|finalizare|my-account|contul-meu|login|logare|lost-password)(?:\/|$|[?#]))/i;

export function isTechnicalUrl(url: string): boolean {
  return TECHNICAL_URL.test(url ?? '');
}

/**
 * Website hygiene, in what a claim SAYS (EN / RO / IT / DE): counters, sitemaps, indexing, maintenance pages, broken
 * links, SEO / meta / plugins. Useful later; never a business tension or a question unless the founder raises it.
 */
const HYGIENE = /(sitemap|\bxml\b|maintenance|mentenan[țt]|\bindex(at|ate|ată|ed|ing|iert)?\b|\bindexa|\bseo\b|meta[- ]?(tag|descri)|\bplugin|\bcache\b|\b404\b|broken (link|page)|link(uri)? (rupt|stricat)|pagin[ăa] (goal[ăa]|nefinalizat)|contor(ul)?\b|counter\b|\b0\s?\+|nefinalizat\w* tehnic|technically unfinished|placeholder|lorem ipsum|under construction|în construcție|wordpress|elementor|woocommerce)/i;

export function isWebsiteHygiene(text: string): boolean {
  return HYGIENE.test(text ?? '');
}

import type { UntrustedReason } from './contracts';

export interface SourceTrust { readonly trusted: boolean; readonly why: string | null; readonly reason?: UntrustedReason }

/** Trust for one source the synthesis read. */
export function sourceTrust(o: PageObservation | undefined): SourceTrust {
  if (!o) return { trusted: false, why: 'a source BB did not read', reason: 'unread' };
  if (o.provenance === 'declared' || o.sourceKind === 'instagram' || o.sourceKind === 'supplied') return { trusted: true, why: null };
  if (isTechnicalUrl(o.url) || /sitemap/i.test(`${o.ref} ${o.pageType}`)) return { trusted: false, why: 'a technical page (sitemap, maintenance, shop mechanics), not business content', reason: 'technical' };
  if (o.discoveredVia === 'sitemap') return { trusted: false, why: 'listed only in the sitemap, not linked from the homepage: it may be old or unused', reason: 'sitemap_only' };
  return { trusted: true, why: null };
}

/** ref → trust, for every source the synthesis read (matched loosely, as refs are cited). */
export function trustByRef(observations: readonly PageObservation[]): (ref: string) => SourceTrust {
  const norm = (r: string): string => (r ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const by = new Map<string, SourceTrust>();
  for (const o of observations) by.set(norm(o.ref), sourceTrust(o));
  return (ref: string) => {
    const hit = by.get(norm(ref));
    if (hit) return hit;
    // A ref the model invented or a sitemap it read as a page: never evidence.
    return /sitemap|\.xml/i.test(ref) ? { trusted: false, why: 'a technical page (sitemap), not business content', reason: 'technical' } : { trusted: false, why: 'a source BB did not read', reason: 'unread' };
  };
}
