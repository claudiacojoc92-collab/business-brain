/**
 * Recommendation — the FIRST Product Primitive under ADR-010 (the doc's own worked example, §44-53).
 *
 * INTERNAL (Layer 1): a Recommendation IS an `inferred` claim — an EvidenceFragment with
 * confidenceKind 'inferred', governed by ADR-007 like all inference, carrying derived_from (the
 * grounded evidence + external patterns it rests on). It introduces NO new epistemic/confidence kind
 * (Invariant 4) and duplicates NO inference logic: it COMPOSES an inferred claim the existing pipeline
 * already produced (recompute → resolveDerivedFrom → what-matters). Its truth status stays `inferred`;
 * it is never voiced as observed or declared fact (Invariant 7).
 *
 * EXTERNAL (Layer 2): a behavioral CONTRACT of mandatory disclosure (ADR-010 §49). To be EMITTED a
 * Recommendation must declare, in the founder's language: (a) what it rests on (evidence basis),
 * (b) what it assumes (explicit external patterns), (c) its confidence, and (d) founder-facing
 * "what I'd do" language, labeled a read. The contract ADDS duties and subtracts nothing from Layer 1
 * (Invariants 3, 5). FAIL CLOSED: an attempt missing evidence-basis, assumptions, or confidence
 * produces nothing — honesty is inherited by construction (Invariants 5, 6), primitives add duties,
 * never exemptions.
 *
 * `confidence` below is a Layer-2 disclosure field — NOT an epistemic kind. The Layer-1
 * `confidenceKind` (observed | declared | inferred) is untouched; nothing here adds to it.
 */
import type { EvidenceFragment } from '@bb/domain';

export type Confidence = 'low' | 'medium' | 'high';
const CONFIDENCE = new Set<Confidence>(['low', 'medium', 'high']);

/** Layer-2 disclosure contract. Every field is a duty the primitive ADDS; none weakens Layer 1. */
export interface RecommendationContract {
  evidenceBasis: string[]; // (a) what it rests on — real evidence fragment ids, ⊆ the claim's derived_from
  assumptions: string[];   // (b) explicit external business patterns it assumes (disclosed, never asserted as fact)
  confidence: Confidence;  // (c) disclosed confidence (a product-layer read, not an epistemic kind)
  recommendation: string;  // (d) founder-facing "what I'd do" (rendered as a read — see renderRecommendation)
}

/** A Recommendation = an `inferred` claim (Layer 1) under a disclosure contract (Layer 2). */
export interface Recommendation {
  claim: EvidenceFragment;          // confidenceKind === 'inferred' — the Layer-1 substrate
  contract: RecommendationContract;
}

/** Label that keeps a Recommendation a READ, never a fact (ADR-010 §51, Invariant 7). */
export const RECOMMENDATION_LABEL = "My read — what I'd do (a recommendation, not a fact)";

/**
 * EMIT a Recommendation — FAIL CLOSED. Returns null (nothing) unless every Layer-1 and Layer-2 duty
 * is met:
 *   Layer 1 — the claim is inference: confidenceKind 'inferred' WITH non-empty derived_from (ADR-007).
 *     This also holds the epistemic ceiling: a marketContext external-reality item is never a persisted
 *     inferred fragment, so it can never be laundered into a recommendation that asserts fact.
 *   Layer 2 — the contract discloses: a non-empty evidence basis whose ids are ALL real (⊆ derived_from
 *     — no fabricated basis), non-empty assumptions, a valid confidence, and founder-facing language.
 * Missing any duty → nothing.
 */
export function emitRecommendation(claim: EvidenceFragment, c: Partial<RecommendationContract>): Recommendation | null {
  if (claim.confidenceKind !== 'inferred') return null;         // Layer 1: only inference, never observed/declared fact
  const provenance = claim.derivedFrom ?? [];
  if (provenance.length === 0) return null;                     // inferred requires provenance (ADR-007); no derived_from → not a claim

  const evidenceBasis = (c.evidenceBasis ?? []).filter(Boolean);
  const assumptions = (c.assumptions ?? []).map((a) => a.trim()).filter(Boolean);
  const confidence = c.confidence;
  const recommendation = c.recommendation?.trim();

  if (evidenceBasis.length === 0) return null;                                   // (a) must disclose what it rests on
  if (!evidenceBasis.every((id) => provenance.includes(id))) return null;        // basis must be REAL evidence (no fabrication)
  if (assumptions.length === 0) return null;                                     // (b) must disclose its assumptions
  if (!confidence || !CONFIDENCE.has(confidence)) return null;                   // (c) must disclose a valid confidence
  if (!recommendation) return null;                                              // (d) must carry founder-facing language

  return { claim, contract: { evidenceBasis, assumptions, confidence, recommendation } };
}

/**
 * Render a Recommendation in founder-facing language, LABELED a read (never observed/declared fact),
 * with its full disclosure: what it rests on, what it assumes, and its confidence. Asserts nothing as
 * fact — the external patterns appear under "assuming", not as claims about the world.
 */
export function renderRecommendation(r: Recommendation): string {
  return [
    `${RECOMMENDATION_LABEL}:`,
    r.contract.recommendation,
    ``,
    `What this rests on: ${r.contract.evidenceBasis.join(', ')}`,
    `What I'm assuming: ${r.contract.assumptions.join('; ')}`,
    `Confidence: ${r.contract.confidence}`,
  ].join('\n');
}
