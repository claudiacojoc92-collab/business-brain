import type { IEvidenceRepository } from '@bb/domain';
import type { IBusinessEvidenceLinkRepository } from '../bi/contracts';
import { bridgeFragmentsToObservations } from '../bi/bridge';
import type { IBusinessSourceReader, SourceExcerpt } from './contracts';

/**
 * Reads the sources a founder POURED IN for a business (website pages, uploaded brochures/PDFs, pasted links,
 * Instagram) and projects them into readable excerpts for the conversation model. It reuses the SAME projection
 * as the pour-in bridge (bridgeFragmentsToObservations + the declared-fragment shape) so there is ONE definition
 * of "what a bound source looks like" — the strategist reads exactly what the understanding synthesis read.
 *
 * Bounded on purpose: at most MAX_SOURCES excerpts, each capped at PER_SOURCE_CHARS, so the conversation prompt
 * never overflows however much the founder poured in. The understanding SNAPSHOT remains the distilled view; this
 * is the raw material behind it, so the conversation never asks about something a source already answers.
 */
const PER_SOURCE_CHARS = 3500;
const MAX_SOURCES = 12;

/** Non-content website URLs that pollute the source list — sitemaps, XML feeds, robots. Never founder-facing. */
function isJunkWeb(url: string, ref: string): boolean {
  return /sitemap|\.xml(?:$|\?)|\/robots\.txt|\/feed\/?$/i.test(url) || /sitemap/i.test(ref);
}

export class BoundSourceReader implements IBusinessSourceReader {
  constructor(
    private readonly links: IBusinessEvidenceLinkRepository,
    private readonly evidence: IEvidenceRepository,
  ) {}

  async listForBusiness(businessId: string, founderId: string): Promise<SourceExcerpt[]> {
    const boundIds = new Set(await this.links.listFragmentIds(businessId));
    if (boundIds.size === 0) return [];
    const mine = (await this.evidence.findByFounder(founderId)).filter((f) => boundIds.has(f.id));

    // Material the founder HANDED OVER (declared brochures/PDFs/links; observed Instagram) — the highest-signal
    // sources, chosen deliberately. These go FIRST so a site with hundreds of bound page fragments can never
    // starve the brochures out of the cap (the real Body Move failure: 505 website fragments buried both PDFs).
    const handed: SourceExcerpt[] = [];
    for (const f of mine) {
      if (f.source === 'website') continue;
      const payload = (f.payload ?? {}) as Record<string, unknown>;
      if (payload['kind'] === 'block') continue;
      const text = typeof payload['text'] === 'string' ? (payload['text'] as string).trim() : '';
      if (!text) continue;
      const ref =
        typeof payload['ref'] === 'string' && (payload['ref'] as string)
          ? (payload['ref'] as string)
          : f.source === 'instagram'
            ? 'Instagram'
            : 'What you uploaded';
      handed.push({
        ref,
        provenance: f.confidenceKind === 'observed' ? 'observed' : 'declared',
        pageType: typeof payload['pageType'] === 'string' ? (payload['pageType'] as string) : f.source,
        text,
      });
    }

    // Observed website pages — same projection the bridge/synthesis uses (stable, deduped, readable refs), with
    // sitemap/XML/robots junk filtered out (they carry no business meaning and only crowd the cap).
    const web: SourceExcerpt[] = [];
    for (const o of bridgeFragmentsToObservations(mine.filter((f) => f.source === 'website'), '')) {
      const text = o.text.trim();
      if (!text || isJunkWeb(o.url, o.ref)) continue;
      web.push({ ref: o.ref, provenance: 'observed', pageType: o.pageType ?? 'website', text });
    }

    // Handed-over material first, then observed pages; bounded, per-source capped.
    return [...handed, ...web]
      .slice(0, MAX_SOURCES)
      .map((s) => ({ ...s, text: s.text.length > PER_SOURCE_CHARS ? s.text.slice(0, PER_SOURCE_CHARS) : s.text }));
  }
}
