import { normalizeNeedle } from '../atoms/atom-extraction.service';
import type { LandingDraft, LandingProposition } from './contracts';

/**
 * Per-section provenance for the draft surface — the honest answer to "touch this section, which fact backs it
 * and where did that fact come from?". THREE states, never blurred (the operator's non-negotiable):
 *
 *   • 'anchored'    — a licensed ATOM (carries a resolvable sourceUrl) appears VERBATIM in the section. We can
 *                     name the fact and the page it came from, because verbatim anchoring guarantees it is there.
 *   • 'synthesized' — BB-generated prose not backed by any anchored atom: BB's reading of the business, NOT a
 *                     sourced quote. No source is claimed (claiming one would be the lie this guard exists to stop).
 *   • 'founder'     — the founder HAND-EDITED this section. Their words, their liability; no gate ran and no
 *                     source is BB's to claim. Shown plainly as "your text".
 *
 * Matching uses the SAME diacritic-fold + whitespace-insensitive normalization as atom anchoring (one boundary,
 * single-sourced from the atom lane) — so an anchored fact always matches its own section regardless of how the
 * generator cased or accented it. Undated: a section may be anchored AND contain synthesized connective prose;
 * we show the sourced facts and never imply the whole section is a quote.
 */
export type FactSource = 'anchored' | 'synthesized' | 'founder';
export interface SectionFact {
  readonly source: FactSource;
  readonly text: string | null;     // the backing fact (anchored); null for synthesized / founder
  readonly sourceUrl: string | null; // where the fact came from (anchored); null otherwise
}
export interface SectionProvenance {
  readonly role: string;            // section role, or 'cta'
  readonly facts: SectionFact[];
}

/** An atom-backed proposition: one with a resolvable sourceUrl. Only these can be shown as 'anchored'. */
function anchoredProps(props: readonly LandingProposition[]): LandingProposition[] {
  return props.filter((p) => typeof p.sourceUrl === 'string' && p.sourceUrl.length > 0);
}

/** The anchored facts whose folded value is present in the folded body. Verbatim anchoring makes this true, not
 *  a guess. De-duplicated by (text + url) so a fact repeated across propositions shows once. */
function anchoredIn(body: string, anchored: readonly LandingProposition[]): SectionFact[] {
  const haystack = normalizeNeedle(body);
  const seen = new Set<string>();
  const out: SectionFact[] = [];
  for (const p of anchored) {
    const needle = normalizeNeedle(p.text);
    if (!needle || !haystack.includes(needle)) continue;
    const key = `${p.text}\u0000${p.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: 'anchored', text: p.text, sourceUrl: p.sourceUrl ?? null });
  }
  return out;
}

function classify(body: string, origin: 'founder' | undefined, anchored: readonly LandingProposition[]): SectionFact[] {
  if (origin === 'founder') return [{ source: 'founder', text: null, sourceUrl: null }];
  const hits = anchoredIn(body, anchored);
  return hits.length > 0 ? hits : [{ source: 'synthesized', text: null, sourceUrl: null }];
}

/** Resolve provenance for every section + the CTA. Pure: no I/O, deterministic for a (draft, propositions) pair. */
export function resolveProvenance(draft: LandingDraft, props: readonly LandingProposition[]): SectionProvenance[] {
  const anchored = anchoredProps(props);
  const sections = draft.sections.map((s): SectionProvenance => ({ role: s.role, facts: classify(s.body, s.origin, anchored) }));
  return [...sections, { role: 'cta', facts: classify(draft.cta, draft.ctaOrigin, anchored) }];
}
