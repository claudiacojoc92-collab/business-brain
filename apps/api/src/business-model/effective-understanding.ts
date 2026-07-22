/**
 * Effective current Understanding — composed at read time from two sources, WITHOUT mutating either:
 *   (1) the website-synthesis conclusions (versioned `understanding`), and
 *   (2) founder-governed items (`understanding_item`: clarity acceptances + founder corrections).
 * A synthesized conclusion is effective unless a current founder correction supersedes it (origin_conclusion_ref). A
 * founder-governed item is current unless a later item supersedes it. Unknowns stay visible until genuinely resolved.
 * Acceptance never converts uncertainty into fact — an "unconfirmed / we disagree" item stays a disagreement, surfaced as
 * such. This is the single founder-facing view of the accumulating understanding; it is also what later clarity draws on.
 */
import type { Understanding } from './understanding';
import type { UnderstandingItem } from './pg-understanding-item.repository';
import type { TruthLabel } from './clarity-result';
import { labelOfConclusion } from './clarity-context';

export interface EffectiveItem {
  id: string;
  statement: string;
  label: TruthLabel;
  source: 'observed' | 'founder';   // where it came from, in plain terms
  origin: 'synthesis' | 'clarity_acceptance' | 'founder_correction';
  createdAt: string | null;
}
export interface EffectiveUnderstanding {
  current: EffectiveItem[];          // the effective, plain-language understanding
  unknowns: string[];                // open unknowns (not yet resolved)
  disagreements: EffectiveItem[];    // current items that remain "unconfirmed / we disagree"
  recentlyAccepted: EffectiveItem[]; // current items that came from accepting a clarity proposal (newest first)
}

/** Compose the effective understanding. `items` are ALL founder-governed items (current derived here). */
export function composeEffectiveUnderstanding(understanding: Understanding | null, items: UnderstandingItem[]): EffectiveUnderstanding {
  const supersededIds = new Set(items.map((i) => i.supersedesItemId).filter((x): x is string => !!x));
  const currentItems = items.filter((i) => !supersededIds.has(i.id));
  const correctedConclusionRefs = new Set(currentItems.map((i) => i.originConclusionRef).filter((x): x is string => !!x));
  const resolvedUnknownRefs = new Set(currentItems.map((i) => i.resolvesUnknownRef).filter((x): x is string => !!x));

  // synthesized conclusions that are still effective (not rejected, not corrected by a founder item)
  const synth: EffectiveItem[] = (understanding?.conclusions ?? [])
    .filter((c) => c.confirmationState !== 'rejected' && !correctedConclusionRefs.has(c.id))
    .filter((c) => c.type !== 'missing_information') // unknowns handled separately
    .map((c) => ({ id: c.id, statement: c.founderCorrection?.trim() || c.statement, label: labelOfConclusion(c), source: 'observed' as const, origin: 'synthesis' as const, createdAt: null }));

  const founder: EffectiveItem[] = currentItems.map((i) => ({ id: i.id, statement: i.statement, label: i.truthLabel, source: 'founder' as const, origin: i.origin, createdAt: i.createdAt }));

  const current = [...synth, ...founder];
  const unknowns = (understanding?.conclusions ?? [])
    .filter((c) => (c.type === 'missing_information' || c.epistemicStatus === 'NEEDS_MORE_EVIDENCE') && c.confirmationState !== 'rejected')
    .filter((c) => !resolvedUnknownRefs.has(c.id))
    .map((c) => c.founderCorrection?.trim() || c.statement);

  const disagreements = current.filter((i) => i.label === 'unconfirmed_or_disagree');
  const recentlyAccepted = founder.filter((i) => i.origin === 'clarity_acceptance').sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  return { current, unknowns, disagreements, recentlyAccepted };
}
