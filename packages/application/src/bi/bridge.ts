import type { EvidenceFragment, WebObservation } from '@bb/domain';
import type { PageObservation } from './contracts';

/** Stable, sanitized URI for one piece of founder-supplied material (never a fetched page). */
export const suppliedUri = (n: number): string => `founder://supplied/${n}`;
/** True when an observation/source URL is founder-supplied (declared), not an observed web page. */
export const isSuppliedUrl = (u: string): boolean => (u ?? '').startsWith('founder://supplied/');

/**
 * Project founder-SUPPLIED material (one pasted text block) into DECLARED source observations for the shared
 * synthesis path. Splits on blank lines into distinct "pieces the founder gave me" so findings can cite a
 * specific piece; falls back to one observation. Provenance is 'declared' — never presented as an observed
 * page. Empty/whitespace input → [] (the caller decides how to continue honestly).
 */
export function suppliedMaterialToObservations(material: string, lang: string | null = null): PageObservation[] {
  const whole = (material ?? '').trim();
  if (!whole) return [];
  const MAX_PIECES = 8;
  const PIECE_CHARS = 4000;
  const segments = whole.split(/\n\s*\n+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const pieces = (segments.length > 1 ? segments : [whole]).slice(0, MAX_PIECES);
  const multi = pieces.length > 1;
  return pieces.map((text, i) => ({
    ref: multi ? `What you told me (${i + 1})` : 'What you told me',
    url: suppliedUri(i + 1),
    pageType: 'founder_supplied',
    title: null,
    text: text.length > PIECE_CHARS ? text.slice(0, PIECE_CHARS) : text,
    lang,
    provenance: 'declared' as const,
  }));
}

/**
 * Canonical host for a founder-entered business URL, without a leading www.
 *
 * Founders type bare domains ("basecamp.com", "www.basecamp.com") — the onboarding field even
 * placeholders "yourbusiness.com" with no scheme. `new URL()` throws without a scheme, so a bare
 * domain previously normalized to '' and silently matched zero stored fragments (all stored under
 * their real host by ingestion's own normalization). Prepend a scheme when absent so scheme-full and
 * scheme-less equivalents resolve to the SAME canonical host. Malformed input still fails safely ('').
 */
export function hostOf(u: string): string {
  try {
    const trimmed = (u ?? '').trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const TYPE_LABELS: Record<string, string> = {
  home: 'Homepage',
  homepage: 'Homepage',
  about: 'About',
  services: 'Services',
  service: 'Services',
  products: 'Products',
  product: 'Products',
  pricing: 'Pricing',
  contact: 'Contact',
  blog: 'Blog',
};

function labelFor(pageType: string, url: string, title: string | null): string {
  const key = (pageType || '').toLowerCase();
  if (TYPE_LABELS[key]) return TYPE_LABELS[key];
  let path = 'Page';
  try {
    const p = new URL(url).pathname.replace(/\/$/, '');
    path = p === '' ? 'Homepage' : (p.split('/').filter(Boolean).slice(-1)[0] ?? 'Page');
  } catch {
    /* keep default */
  }
  if (path === 'Homepage') return 'Homepage';
  if (title && title.trim()) return title.trim().slice(0, 40);
  return path.charAt(0).toUpperCase() + path.slice(1);
}

interface PageItem {
  url: string;
  title: string | null;
  text: string;
  pageType: string;
  lang: string | null;
}

/** Shared: dedupe by url, drop empty text, assign unique founder-readable refs. */
function toPageObservations(items: PageItem[]): PageObservation[] {
  const seen = new Set<string>();
  const obs: PageObservation[] = [];
  for (const it of items) {
    if (!it.url || seen.has(it.url)) continue;
    if (it.text.trim().length === 0) continue;
    seen.add(it.url);
    obs.push({ ref: labelFor(it.pageType, it.url, it.title), url: it.url, pageType: it.pageType, title: it.title, text: it.text, lang: it.lang, provenance: 'observed' });
  }
  const counts = new Map<string, number>();
  return obs.map((o) => {
    const n = (counts.get(o.ref) ?? 0) + 1;
    counts.set(o.ref, n);
    return n === 1 ? o : { ...o, ref: `${o.ref} (${n})` };
  });
}

/**
 * The evidence→understanding BRIDGE (first-class boundary), step 1: project business-linked,
 * immutable PAGE evidence fragments into page items used to build canonical ledger observations.
 * Never mutates a fragment; never turns inference into observation.
 */
export function bridgeFragmentsToObservations(fragments: EvidenceFragment[], websiteHost: string): PageObservation[] {
  const items: PageItem[] = [];
  for (const f of fragments) {
    if (f.source !== 'website') continue;
    const payload = (f.payload ?? {}) as Record<string, unknown>;
    if (payload['kind'] === 'block') continue; // page fragments only
    if (websiteHost && (f.platform ?? '').replace(/^www\./, '') !== websiteHost) continue;
    const url = f.sourceUrl ?? '';
    const text = typeof payload['text'] === 'string' ? (payload['text'] as string) : '';
    items.push({
      url,
      title: typeof payload['title'] === 'string' ? (payload['title'] as string) : null,
      text,
      pageType: typeof payload['pageType'] === 'string' ? (payload['pageType'] as string) : 'page',
      lang: typeof payload['lang'] === 'string' ? (payload['lang'] as string) : null,
    });
  }
  return toPageObservations(items);
}

/**
 * The bridge, step 2: re-project canonical ledger web observations back into page observations for
 * synthesis. This is what makes Slice-1 synthesis consume the LEDGER-backed understanding (not a
 * parallel read of raw fragments). Same labelling/dedup as step 1, so refs are stable.
 */
export function webObservationsToPageObservations(observations: readonly WebObservation[]): PageObservation[] {
  return toPageObservations(
    observations.map((o) => ({
      url: o.payload.url,
      title: o.payload.title,
      text: o.payload.text,
      pageType: o.payload.pageType,
      lang: o.payload.lang,
    })),
  );
}
