/**
 * Part 1 — PROOF EXTRACTION contracts.
 *
 * Documented proof on an ingested source becomes a LICENSABLE proofFact ONLY when it is true by construction:
 * someone is quoted as having said it (a testimonial), or it is a checkable fact about the business
 * (credential/award/tenure/location/count), or it is a case study naming a client, or a figure the page
 * attributes to a NAMED external source. A business's own unsourced performance figures / superlatives /
 * rankings are NOT proof of anything except that the business claims them — they are routed to the separate
 * unsourced-claim store, visible for audit, and NEVER licensed. (Amendment 2.)
 *
 * Every proofFact carries DURABLE provenance (source_url + verbatim anchor quote), persisted in V080, so the
 * origin is answerable months later from the database alone. (Amendment 1.)
 */

export type ProofKind =
  | 'testimonial' | 'credential' | 'award' | 'tenure' | 'location'
  | 'team_size' | 'service_count' | 'case_study' | 'external_sourced_figure';

/** Kinds licensable as checkable business facts / attributed statements. */
export const LICENSABLE_PROOF_KINDS: ProofKind[] = ['testimonial', 'credential', 'award', 'tenure', 'location', 'team_size', 'service_count', 'case_study', 'external_sourced_figure'];

export type UnsourcedReason = 'self_published_performance_figure' | 'superlative' | 'ranking' | 'outcome_statistic' | 'growth_figure';

/** One readable source unit handed to the extractor (a page or a poured-in document), with resolvable provenance. */
export interface ProofSourceUnit {
  readonly sourceRef: string;   // founder-readable label
  readonly sourceUrl: string;   // resolvable provenance (http URL or founder:// URI); never empty
  readonly pageType: string;
  readonly text: string;
}

/** Raw model output — re-verified deterministically before anything is trusted. */
export interface ProofCandidate {
  readonly kind: ProofKind;
  readonly anchorQuote: string;       // MUST be a verbatim substring of the cited unit's text
  readonly attribution?: string | null; // named client / external source when present
  readonly externalSource?: string | null; // a named study/regulator/review platform, if the figure cites one
  readonly sourceRef: string;
}
export interface UnsourcedCandidate {
  readonly claimText: string;
  readonly anchorQuote: string;
  readonly exclusionReason: UnsourcedReason;
  readonly sourceRef: string;
}
export interface ProofModelOutput { readonly proofs: ProofCandidate[]; readonly unsourced: UnsourcedCandidate[]; }

export interface ProofExtractionInput { readonly businessName: string; readonly units: ProofSourceUnit[]; }
export interface IProofExtractionModel { extract(input: ProofExtractionInput): Promise<ProofModelOutput>; }

/** A verified, licensable proof fact with durable provenance (persisted). */
export interface ProofFact {
  readonly id: string;
  readonly businessId: string;
  readonly kind: ProofKind;
  readonly licensedText: string;      // the WRAPPED reported-speech form actually licensed
  readonly anchorQuote: string;
  readonly attribution: string | null;
  readonly sourceRef: string;
  readonly sourceUrl: string;
  readonly sourceFingerprint: string;
  readonly modelId: string | null;
  readonly extractedAt: string;
}
export interface UnsourcedClaim {
  readonly id: string;
  readonly businessId: string;
  readonly claimText: string;
  readonly anchorQuote: string;
  readonly exclusionReason: UnsourcedReason;
  readonly sourceRef: string;
  readonly sourceUrl: string;
  readonly sourceFingerprint: string;
  readonly extractedAt: string;
}

export interface IProofFactRepository {
  latestFingerprint(businessId: string): Promise<string | null>;
  /** Replace the business's proof + unsourced sets for a new source fingerprint (idempotent per fingerprint). */
  replaceForBusiness(businessId: string, fingerprint: string, proofs: ProofFact[], unsourced: UnsourcedClaim[]): Promise<void>;
  listProof(businessId: string): Promise<ProofFact[]>;
  listUnsourced(businessId: string): Promise<UnsourcedClaim[]>;
}

/** Narrow evidence read port (concrete PgEvidenceRepository satisfies it structurally — no change to IEvidenceRepository). */
import type { EvidenceFragment } from '@bb/domain';
export interface IProofFragmentSource { findByIds(ids: string[]): Promise<EvidenceFragment[]>; }
