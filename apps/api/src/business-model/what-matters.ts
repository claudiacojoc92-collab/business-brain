/**
 * Capability C v1 — Tell Me What Matters. A CONSUMER/RANKER of the declared-vs-observed TENSIONS
 * the reflection already produces (B v1 Phase 3). It generates NO new insight, recommends NOTHING,
 * and ranks NOTHING that isn't a grounded declared-vs-observed tension. No grounded tension → no
 * C output. It reuses the existing inferred claims, the existing gate, the existing transport — no
 * new confidence_kind, no second pipeline, engine untouched.
 *
 * A "grounded tension" is a TENSION-category inferred claim (contradiction / blindSpot /
 * hiddenWeakness) whose `derived_from` spans BOTH a `declared` (source 'founder') fragment AND an
 * `observed` fragment. FAIL CLOSED: an inferred claim that is not a tension category, or does not
 * span both kinds, is never a C item — it cannot render.
 *
 * The output is an OBSERVATION about stakes ("your declared X and observed Y are in tension, and
 * this is the highest-stakes tension now"), NEVER a prescription ("you should…"). C adds only
 * ranking framing; the tension statement is the engine's own observation, passed through verbatim.
 */
import type { EvidenceFragment } from '@bb/domain';

/** Tension categories C ranks, in priority order (reversible default — do not overthink). */
const TENSION_RANK: Record<string, number> = { contradictions: 0, blindSpots: 1, hiddenWeaknesses: 2 };
/** Declared fields whose tension is most central (goal/direction) — higher centrality (reversible default). */
const CENTRAL_FIELDS = new Set(['direction', 'target']);
const OBSERVED_SOURCES = new Set(['website', 'upload', 'google']);

export interface WhatMattersItem {
  rank: number;                  // 1 = most prominent
  category: string;              // the tension type (contradictions / blindSpots / hiddenWeaknesses)
  statement: string;             // the engine's tension observation — C does NOT rewrite it
  stakes: string;                // C's OBSERVATION about ranking (never a prescription)
  fragmentIds: string[];         // derived_from — spans a declared + an observed fragment
  declaredFragmentIds: string[];
  observedFragmentIds: string[];
}

interface Grounded { f: EvidenceFragment; declaredIds: string[]; observedIds: string[] }

/** Filter inferred claims to grounded declared-vs-observed tensions. Fail closed on both counts. */
export function groundedTensions(inferred: EvidenceFragment[], byId: Map<string, EvidenceFragment>): Grounded[] {
  const out: Grounded[] = [];
  for (const f of inferred) {
    if (f.confidenceKind !== 'inferred') continue;
    const category = String(f.payload?.['category'] ?? '');
    if (!(category in TENSION_RANK)) continue;                       // only tension types
    const ids = Array.isArray(f.derivedFrom) ? [...f.derivedFrom] : [];
    const declaredIds = ids.filter((id) => { const g = byId.get(id); return g?.confidenceKind === 'declared' && g.source === 'founder'; });
    const observedIds = ids.filter((id) => { const g = byId.get(id); return g?.confidenceKind === 'observed' && OBSERVED_SOURCES.has(g.source); });
    if (declaredIds.length === 0 || observedIds.length === 0) continue; // must span BOTH — else not a tension
    out.push({ f, declaredIds, observedIds });
  }
  return out;
}

/** 0 if the tension cites a central declared field (direction/target), else 1. */
function centrality(declaredIds: string[], byId: Map<string, EvidenceFragment>): number {
  return declaredIds.some((id) => CENTRAL_FIELDS.has(String(byId.get(id)?.payload?.['field'] ?? ''))) ? 0 : 1;
}

/** Rank grounded tensions: tension type, then declared-fragment centrality (both reversible defaults). */
export function rankTensions(inferred: EvidenceFragment[], all: EvidenceFragment[]): Grounded[] {
  const byId = new Map(all.map((f) => [f.id, f]));
  return groundedTensions(inferred, byId).sort((a, b) => {
    const ca = TENSION_RANK[String(a.f.payload?.['category'])] ?? 9;
    const cb = TENSION_RANK[String(b.f.payload?.['category'])] ?? 9;
    if (ca !== cb) return ca - cb;
    return centrality(a.declaredIds, byId) - centrality(b.declaredIds, byId);
  });
}

// Stakes framing — pure OBSERVATION about ranking. NO imperatives, NO recommendations.
const STAKES = [
  'The highest-stakes place your intent and your evidence pull apart right now.',
  'Also pulling against what you told me.',
  'A third gap between what you\'re building and what you\'ve shown.',
];

/**
 * "What matters now" — the top grounded declared-vs-observed tensions as prioritized OBSERVATIONS.
 * Top 1 prominent + up to 2 more (reversible default). Every item traces to its declared + observed
 * fragments; an item with no grounded pair cannot be produced (fail closed). Empty in → empty out.
 */
export function buildWhatMattersNow(inferred: EvidenceFragment[], all: EvidenceFragment[], limit = 3): WhatMattersItem[] {
  return rankTensions(inferred, all).slice(0, limit).map((t, i) => ({
    rank: i + 1,
    category: String(t.f.payload?.['category'] ?? ''),
    statement: String(t.f.payload?.['statement'] ?? ''), // engine's observation, verbatim — C never rewrites or prescribes
    stakes: STAKES[i] ?? 'Also in tension.',
    fragmentIds: [...(t.f.derivedFrom ?? [])],
    declaredFragmentIds: t.declaredIds,
    observedFragmentIds: t.observedIds,
  }));
}
