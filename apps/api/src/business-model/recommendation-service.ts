/**
 * Recommendation service (ADR-010 Layer 2) — produce, persist-shape, and display Recommendations over
 * REAL inference. Composes the C1 primitive (recommendation.ts) with the EXISTING recompute output.
 *
 * HARD CONSTRAINT (ADR-010: no duplicated inference / no second pipeline): this runs NO inference and
 * asks the engine for NOTHING new. It reuses only what recompute already produced — the persisted
 * `inferred` claims, the model's `marketContext` (external patterns), and evidence strength. Confidence
 * is a reversible heuristic; assumptions are the engine's own external patterns, disclosed (not asserted).
 */
import type { EvidenceFragment } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { emitRecommendation, type Recommendation, type Confidence } from './recommendation';

// Grounded Layer-1 insight categories the engine already emits — each is framed (not re-inferred) as a
// recommendation ("here's my read on what I'd do about this"). No new inference; the substance is the
// engine's own inferred claim, the advice framing + disclosure is the Layer-2 duty.
const ADVICE_CATEGORIES = new Set(['positioningOpportunities', 'hiddenStrengths', 'hiddenWeaknesses', 'contradictions', 'blindSpots']);

/** Confidence from evidence strength — reversible heuristic over the claim's OWN provenance (no engine
 *  call, no new output): spans declared+observed OR ≥3 evidence → high; ≥2 → medium; else low. */
export function confidenceFromEvidence(claim: EvidenceFragment, byId: Map<string, EvidenceFragment>): Confidence {
  const ev = (claim.derivedFrom ?? []).map((id) => byId.get(id)).filter(Boolean) as EvidenceFragment[];
  const kinds = new Set(ev.map((f) => f.confidenceKind));
  if ((kinds.has('declared') && kinds.has('observed')) || ev.length >= 3) return 'high';
  if (ev.length >= 2) return 'medium';
  return 'low';
}

/** External patterns the engine ALREADY produced (marketContext / i-know), disclosed as ASSUMPTIONS.
 *  Ceiling-clean only: a marketContext item carrying an evidence chain is a ceiling violation and is NOT
 *  disclosed (that would launder founder evidence into external fact). These are assumptions we DECLARE,
 *  never facts we assert. Reuses existing recompute output — no second inference call. */
export function assumptionsFromModel(model: BusinessModel): string[] {
  const mc = (model.marketContext ?? []) as Array<{ statement?: string; evidenceChain?: unknown[] }>;
  return mc
    .filter((m) => !(Array.isArray(m.evidenceChain) && m.evidenceChain.length > 0))
    .map((m) => String(m.statement ?? '').trim())
    .filter(Boolean);
}

/**
 * Produce Recommendations from a REAL recompute, reusing only existing output. Each advice-shaped
 * `inferred` claim is composed into a Recommendation via the FAIL-CLOSED emitRecommendation; a claim
 * missing any contract duty (e.g. no disclosable assumptions) is dropped honestly — nothing fabricated.
 */
export function recommendationsFromRecompute(model: BusinessModel, all: EvidenceFragment[]): Recommendation[] {
  const byId = new Map(all.map((f) => [f.id, f]));
  const assumptions = assumptionsFromModel(model);
  const claims = all.filter((f) => f.confidenceKind === 'inferred' && ADVICE_CATEGORIES.has(String(f.payload?.['category'] ?? '')));
  const out: Recommendation[] = [];
  for (const claim of claims) {
    const rec = emitRecommendation(claim, {
      evidenceBasis: [...(claim.derivedFrom ?? [])],              // (a) the claim's real provenance
      assumptions,                                                 // (b) the engine's existing external patterns
      confidence: confidenceFromEvidence(claim, byId),             // (c) heuristic from evidence strength
      recommendation: String(claim.payload?.['statement'] ?? ''),  // (d) the engine's opportunity, framed as a read by render
    });
    if (rec) out.push(rec);
  }
  return out;
}

/** Persisted shape (memory.recommendations) — the Layer-2 contract, referencing the Layer-1 claim id. */
export interface StoredRecommendation {
  claimFragmentId: string;
  threadSignature: string | null;
  evidenceBasis: string[];
  assumptions: string[];
  confidence: string;
  recommendationText: string;
}

/** Founder-facing view — joins the stored contract with its Layer-1 claim, PROVING the truth status is
 *  preserved (`truthStatus` must be 'inferred') and resolving the basis ids to disclosable quotes. */
export interface RecommendationView {
  claimFragmentId: string;
  truthStatus: string;                                   // the claim's confidenceKind — MUST be 'inferred'
  claimStatement: string;
  recommendation: string;                                // (d)
  evidenceBasis: Array<{ id: string; quote: string }>;   // (a) resolved to quotes
  assumptions: string[];                                 // (b)
  confidence: string;                                    // (c)
  threadSignature: string | null;
}

export function toRecommendationView(stored: StoredRecommendation, byId: Map<string, EvidenceFragment>): RecommendationView | null {
  const claim = byId.get(stored.claimFragmentId);
  if (!claim || claim.confidenceKind !== 'inferred') return null; // truth-status integrity: the substrate must still be inference
  return {
    claimFragmentId: stored.claimFragmentId,
    truthStatus: claim.confidenceKind,
    claimStatement: String(claim.payload?.['statement'] ?? ''),
    recommendation: stored.recommendationText,
    evidenceBasis: stored.evidenceBasis.map((id) => { const f = byId.get(id); return { id, quote: f ? String(f.payload?.['text'] ?? '').slice(0, 140) : '(evidence not found)' }; }),
    assumptions: stored.assumptions,
    confidence: stored.confidence,
    threadSignature: stored.threadSignature,
  };
}
