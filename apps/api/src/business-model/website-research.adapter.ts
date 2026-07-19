/**
 * Wave 3 — the first ResearchAdapter: RETRIEVAL + EXTRACTION of a KNOWN entity's own public website, reusing
 * the robots-respecting connector primitives (explicit UA, robots.txt, timeout, size + content-type caps,
 * follow-redirects). It does NOT support discovery and does NOT persist pages as the founder's own evidence —
 * a competitor's content is market context, kept separate from the founder's business. Narrow page budget.
 */
import { fetchDocument, fetchRobots, isAllowed } from '../connectors/website/fetcher';
import { extractPage } from '../connectors/website/extract';
import { normalizeUrl } from '../connectors/website/url';
import type { PageOutcome, ResearchAdapter, RetrievalResult, RetrievedPage } from './market-context';

const PAGE_TIMEOUT_MS = 6000;
const PATHS = ['', '/about', '/about-us', '/services', '/products', '/pricing', '/how-it-works'];
const MAX_PAGES = 5; // narrow budget — no crawling

export class WebsiteResearchAdapter implements ResearchAdapter {
  readonly name = 'website-connector';
  readonly extractionVersion = 'extract-1';
  readonly supportsDiscovery = false; // never pretends to discover entities from the open web

  async retrieve(url: string): Promise<RetrievalResult> {
    const pages: RetrievedPage[] = [];
    const attempted: string[] = []; const retrieved: string[] = []; const skipped: string[] = []; const blocked: string[] = [];
    const outcomes: Array<{ url: string; outcome: PageOutcome }> = [];
    let norm: { url: string; origin: string };
    try { const n = normalizeUrl(url) as { url: string; origin: string }; norm = { url: n.url, origin: n.origin }; }
    catch { return { pages, attempted, retrieved, skipped, blocked: [url], outcomes: [{ url, outcome: 'unreachable' }] }; }

    const robots = await fetchRobots(norm.origin).catch(() => null);
    const candidates = Array.from(new Set([norm.url, ...PATHS.map((p) => `${norm.origin}${p}`)])).slice(0, MAX_PAGES + PATHS.length);
    for (const cand of candidates) {
      if (retrieved.length >= MAX_PAGES) break;
      let path = '/';
      try { path = new URL(cand).pathname; } catch { continue; }
      if (robots && !isAllowed(robots, path)) { blocked.push(cand); outcomes.push({ url: cand, outcome: 'blocked' }); continue; }
      attempted.push(cand);
      const res = await fetchDocument(cand, { timeoutMs: PAGE_TIMEOUT_MS });
      if (!res.ok || !res.body) {
        const unsupported = /unsupported content-type/i.test(res.error ?? '');
        skipped.push(cand); outcomes.push({ url: cand, outcome: unsupported ? 'unsupported' : 'unreachable' }); continue;
      }
      const ex = extractPage(res.finalUrl || cand, res.body);
      if (ex.empty || !ex.text) { skipped.push(cand); outcomes.push({ url: cand, outcome: 'empty' }); continue; }
      retrieved.push(cand); outcomes.push({ url: cand, outcome: 'retrieved' });
      pages.push({ url: cand, canonicalUrl: res.finalUrl || cand, title: ex.title ?? null, text: ex.text, sourceType: ex.pageType || 'website' });
    }
    return { pages, attempted, retrieved, skipped, blocked, outcomes };
  }
}

/** Deterministic fake adapter — tests. Returns configured pages (or a robots/unreachable/sparse shape). */
export class FakeResearchAdapter implements ResearchAdapter {
  readonly name = 'fake-adapter';
  readonly extractionVersion = 'fake-1';
  readonly supportsDiscovery = false;
  constructor(private readonly result: RetrievalResult) {}
  async retrieve(): Promise<RetrievalResult> { return this.result; }
}
