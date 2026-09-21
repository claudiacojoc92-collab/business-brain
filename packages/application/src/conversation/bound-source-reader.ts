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
const MAX_SOURCES = 10;

export class BoundSourceReader implements IBusinessSourceReader {
  constructor(
    private readonly links: IBusinessEvidenceLinkRepository,
    private readonly evidence: IEvidenceRepository,
  ) {}

  async listForBusiness(businessId: string, founderId: string): Promise<SourceExcerpt[]> {
    const boundIds = new Set(await this.links.listFragmentIds(businessId));
    if (boundIds.size === 0) return [];
    const mine = (await this.evidence.findByFounder(founderId)).filter((f) => boundIds.has(f.id));

    const out: SourceExcerpt[] = [];

    // Observed website pages — same projection the bridge/synthesis uses (stable, deduped, readable refs).
    for (const o of bridgeFragmentsToObservations(mine.filter((f) => f.source === 'website'), '')) {
      const text = o.text.trim();
      if (text) out.push({ ref: o.ref, provenance: 'observed', pageType: o.pageType ?? 'website', text });
    }

    // Everything else the founder poured in (declared PDFs/brochures/links; observed Instagram) — same shape as
    // the pour-in bridge's `extra` projection, provenance preserved from the fragment.
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
      out.push({
        ref,
        provenance: f.confidenceKind === 'observed' ? 'observed' : 'declared',
        pageType: typeof payload['pageType'] === 'string' ? (payload['pageType'] as string) : f.source,
        text,
      });
    }

    return out.slice(0, MAX_SOURCES).map((s) => ({ ...s, text: s.text.length > PER_SOURCE_CHARS ? s.text.slice(0, PER_SOURCE_CHARS) : s.text }));
  }
}
