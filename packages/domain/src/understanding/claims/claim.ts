import type { ClaimId, SubjectRef, Timestamp } from '../shared/types';

/**
 * A Claim is a PROPOSITION the system recorded — nothing more. It is NOT truth, evidence, verification,
 * confidence, recognition, a founder declaration, evaluation, a recommendation, a correction, or a verdict.
 * A Claim exists so it can be EVALUATED LATER (by an Examiner, against Evidence); therefore no evaluative
 * state ever lives on the Claim. Claims are append-only and immutable; contradictory claims coexist and are
 * never resolved at this layer.
 *
 * Claim v1 states ONLY: "the system recorded this proposition (at recordedAt), for this business." It
 * deliberately does NOT state who authored it, where it came from, how it was derived, what declaration it
 * relates to, what evidence supports it, or whether it is true. Authorship / source / derivation are
 * PROVENANCE — deferred to future immutable records (e.g. ClaimDerivation / ClaimSourceLink /
 * ClaimDeclarationDerivation / ClaimEvidenceLink) that REFERENCE a Claim (by id) without mutating it. That
 * lets provenance be many-to-one and multi-step, instead of forcing one lossy enum onto Claim. (An earlier
 * `ClaimOrigin` field was rejected in review: `founder_authored` vs `system_derived` mixed authorship with
 * process, was not mutually exclusive, duplicated FounderDeclaration, and asserted provenance that — with
 * the linkage contracts deferred — could not be traced. See ADR-010.)
 *
 * PROPOSITION ENVELOPE (Claim v1 — deliberately narrow; see ADR-010):
 *   Claim v1 represents exactly ONE atomic ATTRIBUTE assertion — "subject has predicate = object", where
 *   object is a single scalar value. Unary attribute propositions only.
 *   It CANNOT (in v1) represent, as first-class structure: relations between two subjects (object is a scalar,
 *   never a SubjectRef), comparisons, quantified, conditional, temporal, negative, or causal propositions.
 *   Those richer forms are a future widening (predicate semantics / a structured proposition model / a
 *   dedicated relation contract) — never smuggled into v1.
 */

/** A Claim always asserts a single CONCRETE scalar value. Absence/uncertainty is an Unknown, not a Claim, so `null` is excluded. Arrays/objects are excluded (atomicity). */
export type ClaimObject = string | number | boolean;

export interface Claim {
  readonly id: ClaimId;
  readonly businessRef: SubjectRef; // business scope — every Claim belongs to exactly one business
  readonly subject: SubjectRef; // what the proposition is about (a SubjectRef, never carried as the object)
  /**
   * The predicate key. At the type level this is an ARBITRARY string — TypeScript cannot enforce
   * non-emptiness or "not prose". By CONVENTION it is a stable, opaque predicate key (e.g. 'primary_offer',
   * 'posts_per_week'); non-emptiness and shape are APPLICATION-level validations. Identity is EXACT and
   * case-sensitive. There is no predicate registry in v1.
   */
  readonly predicate: string;
  /** The single asserted concrete value. Strings are arbitrary at the type level; producers use scalar-like values (e.g. 'coaching', 'tuesday') by convention, NOT prose — a convention, not a type guarantee. One value per Claim (atomic). */
  readonly object: ClaimObject;
  readonly recordedAt: Timestamp; // when the SYSTEM recorded the record — server-owned metadata; NOT event time, NOT validity time, NOT ordering
}
