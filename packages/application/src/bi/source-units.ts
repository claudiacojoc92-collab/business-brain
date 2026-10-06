import type { EvidenceFragment } from '@bb/domain';
import { bridgeFragmentsToObservations } from './bridge';

/**
 * One readable source unit — a page or a poured-in document — with resolvable provenance. Shared by
 * proof extraction and atom extraction: both read the same bound fragments and need the same text units.
 */
export interface SourceUnit {
  readonly sourceRef: string;   // founder-readable label
  readonly sourceUrl: string;   // resolvable provenance (http URL or founder:// URI); never empty
  readonly pageType: string;
  readonly text: string;
}

/**
 * Project bound evidence fragments into readable source units WITH resolvable provenance. Declared/handed
 * material (brochures, PDFs, IG) keeps its own ref + a founder:// URI; observed website pages go through
 * the same bridge the understanding synthesis uses (deduped, readable refs + real url), with sitemap/xml
 * dropped. De-duplicated by sourceRef, first occurrence kept.
 *
 * Extracted verbatim from ProofExtractionService.toUnits (2026-10-06, intent/2026-10-06-licensed-atoms);
 * behaviour is pinned by source-units.characterization.test.ts.
 */
export function toSourceUnits(frags: EvidenceFragment[]): SourceUnit[] {
  const units: SourceUnit[] = [];
  // Declared/handed material (brochures, PDFs, IG) — page/doc text with a founder:// or platform URI.
  for (const f of frags) {
    if (f.source === 'website') continue;
    const payload = (f.payload ?? {}) as Record<string, unknown>;
    if (payload['kind'] === 'block') continue;
    const text = typeof payload['text'] === 'string' ? (payload['text'] as string).trim() : '';
    if (!text) continue;
    const ref = typeof payload['ref'] === 'string' && payload['ref'] ? (payload['ref'] as string) : (f.source === 'instagram' ? 'Instagram' : 'Uploaded material');
    units.push({ sourceRef: `${ref}`, sourceUrl: f.sourceUrl ?? `founder://supplied/${f.id}`, pageType: typeof payload['pageType'] === 'string' ? (payload['pageType'] as string) : f.source, text });
  }
  // Observed website pages — same projection the understanding synthesis read (deduped, readable refs + real url).
  for (const o of bridgeFragmentsToObservations(frags.filter((f) => f.source === 'website'), '')) {
    const text = (o.text ?? '').trim();
    if (!text || /sitemap|\.xml(?:$|\?)|\/robots\.txt/i.test(o.url)) continue;
    units.push({ sourceRef: o.ref, sourceUrl: o.url || `source://${o.ref}`, pageType: o.pageType ?? 'website', text });
  }
  // De-dup by sourceRef (bridge refs are stable); keep first.
  const byRef = new Map<string, SourceUnit>();
  for (const u of units) if (!byRef.has(u.sourceRef)) byRef.set(u.sourceRef, u);
  return [...byRef.values()];
}
