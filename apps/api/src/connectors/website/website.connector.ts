/**
 * Website connector (M2.1) — implements the standard connector contract (M2 Blueprint §4),
 * thin where unauthenticated. Its ONLY output is observed evidence appended to the store.
 * It never computes the model, never calls the engine, never reaches downstream.
 */
import { makeFragment, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import { normalizeUrl } from './url';
import { fetchDocument, fetchRobots, isAllowed } from './fetcher';
import { discoverKeyPages, DEFAULT_PAGE_BUDGET } from './discovery';
import { extractPage, type Extracted } from './extract';

export type ConnectionState = 'connecting' | 'reading' | 'synced' | 'partial' | 'empty' | 'failed';
export interface Capabilities { read: boolean; insights: boolean; publish: boolean }

export interface RawPage { url: string; html: string }
export interface ProgressEvent { phase: ConnectionState; message: string; url?: string }

export interface WebsiteReadResult {
  state: ConnectionState;
  founderId: string;
  url: string | null;
  pagesRead: number;
  pagesFailed: number;
  fragmentsStored: number;
  fragmentsDeduped: number;
  gaps: string[];
  error?: string;
}

const PAGE_TIMEOUT_MS = 6000;
const TOTAL_BUDGET_MS = 25_000; // inside the 30s promise
const PAYLOAD_TEXT_CAP = 12_000;

function occurredAtFromJsonLd(jsonld: unknown[]): Date | null {
  for (const block of jsonld) {
    const v = (block as Record<string, unknown>)?.['datePublished'];
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

export class WebsiteConnector {
  private state: ConnectionState = 'connecting';
  constructor(private readonly repo: IEvidenceRepository) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async authorize(): Promise<void> { /* no-op: website is unauthenticated */ }

  capabilities(): Capabilities { return { read: true, insights: false, publish: false }; }

  status(): ConnectionState { return this.state; }

  normalize(page: RawPage): Extracted { return extractPage(page.url, page.html); }

  /** Build observed fragments from normalized pages and append them to the store. */
  async produceEvidence(founderId: string, host: string, pages: RawPage[]): Promise<{ stored: number; deduped: number }> {
    const fragments: EvidenceFragment[] = [];
    for (const page of pages) {
      const ex = this.normalize(page);
      if (ex.empty) continue; // contributes nothing, rather than a hollow fragment
      fragments.push(makeFragment({
        founderId,
        source: 'website',
        platform: host,
        sourceUrl: page.url,
        confidenceKind: 'observed',
        visibility: 'public',
        occurredAt: occurredAtFromJsonLd(ex.jsonld),
        payload: {
          text: ex.text.length > PAYLOAD_TEXT_CAP ? ex.text.slice(0, PAYLOAD_TEXT_CAP) : ex.text,
          pageType: ex.pageType,
          title: ex.title,
          description: ex.description,
          og: ex.og,
          jsonld: ex.jsonld,
          lang: ex.lang,
        },
      }));
    }
    if (fragments.length === 0) return { stored: 0, deduped: 0 };
    return this.repo.appendMany(fragments);
  }

  async disconnect(founderId: string): Promise<void> {
    await this.repo.deleteBySource(founderId, 'website');
  }
}

/**
 * Spine orchestrator: URL → fetch → discover → fetch key pages → observed fragments in
 * store. Emits honest state throughout. STOPS at the evidence boundary (no recompute, no
 * reflection — those are the payoff layer).
 */
export async function readWebsite(args: {
  founderId: string;
  url: string;
  repo: IEvidenceRepository;
  budget?: number;
  onProgress?: (e: ProgressEvent) => void;
}): Promise<WebsiteReadResult> {
  const started = Date.now();
  const progress = (e: ProgressEvent) => args.onProgress?.(e);
  const fail = (error: string, url: string | null = null): WebsiteReadResult => ({
    state: 'failed', founderId: args.founderId, url, pagesRead: 0, pagesFailed: 0,
    fragmentsStored: 0, fragmentsDeduped: 0, gaps: [], error,
  });

  const norm = normalizeUrl(args.url);
  if (!norm.ok) return fail(norm.error);
  progress({ phase: 'connecting', message: 'Checking your site…', url: norm.url });

  const robots = await fetchRobots(norm.origin);
  const entryPath = new URL(norm.url).pathname || '/';
  if (!isAllowed(robots, entryPath)) return fail('This site asks not to be read (robots.txt).', norm.url);

  progress({ phase: 'reading', message: 'Reading your homepage…', url: norm.url });
  const entry = await fetchDocument(norm.url, { timeoutMs: PAGE_TIMEOUT_MS });
  if (!entry.ok || !entry.body) return fail(`I couldn't reach that URL (${entry.error ?? 'no response'}).`, norm.url);

  // Discover key pages (sitemap → nav → common paths), bounded.
  const sitemap = await fetchDocument(`${norm.origin}/sitemap.xml`, { timeoutMs: 3000, accept: 'application/xml,text/xml' });
  const keyPages = discoverKeyPages(
    { entryUrl: entry.finalUrl, origin: norm.origin, entryHtml: entry.body, sitemapXml: sitemap.ok ? sitemap.body : null },
    args.budget ?? DEFAULT_PAGE_BUDGET,
  );

  const pages: RawPage[] = [{ url: entry.finalUrl, html: entry.body }];
  const gaps: string[] = [];
  for (const pageUrl of keyPages) {
    if (pageUrl.replace(/\/$/, '') === entry.finalUrl.replace(/\/$/, '')) continue;
    if (Date.now() - started > TOTAL_BUDGET_MS) { gaps.push(pageUrl); continue; } // time budget → honest gap
    if (!isAllowed(robots, new URL(pageUrl).pathname)) continue;
    progress({ phase: 'reading', message: `Reading ${new URL(pageUrl).pathname}…`, url: pageUrl });
    const res = await fetchDocument(pageUrl, { timeoutMs: PAGE_TIMEOUT_MS });
    if (res.ok && res.body) pages.push({ url: res.finalUrl, html: res.body });
    else gaps.push(pageUrl); // one page failing never fails the run
  }

  const connector = new WebsiteConnector(args.repo);
  const { stored, deduped } = await connector.produceEvidence(args.founderId, norm.host, pages);

  // Honest state resolution.
  let state: ConnectionState;
  if (stored === 0 && deduped === 0) state = 'empty';          // reached site, extracted nothing meaningful
  else if (gaps.length > 0) state = 'partial';                 // some pages read, some gaps
  else state = 'synced';

  return {
    state, founderId: args.founderId, url: norm.url,
    pagesRead: pages.length, pagesFailed: gaps.length,
    fragmentsStored: stored, fragmentsDeduped: deduped, gaps,
  };
}
