/**
 * Wave 3 — known-entity market CONTEXT contract (provider-neutral). Distinguishes the four capabilities so a
 * future search/discovery provider can attach WITHOUT changing the evidence model:
 *   discovery  — finding entities from the open web (NOT supported by the website adapter);
 *   retrieval  — fetching a KNOWN url's permitted public pages (website adapter);
 *   extraction — normalizing retrieved pages into observed text (website adapter);
 *   inference  — BB's tentative, bounded reading of the observation (a separate model; never asserts market fact).
 * Observation and inference are ALWAYS separate. Company sites prove self-claims only.
 */

export type EntityType = 'direct' | 'indirect' | 'alternative' | 'reference';
export type EntityOrigin = 'founder_added' | 'bb_suggested';
export type RelevanceStatus = 'proposed' | 'confirmed' | 'dismissed';
export type FindingResponse = 'unreviewed' | 'confirmed' | 'dismissed' | 'qualified';
export type EpistemicStatus = 'OBSERVED' | 'SYNTHESIZED_FROM_OBSERVED' | 'HYPOTHESIS' | 'NEEDS_MORE_EVIDENCE';

export const ENTITY_TYPES: ReadonlySet<string> = new Set(['direct', 'indirect', 'alternative', 'reference']);

export interface MarketEntity {
  id: string; founderId: string; name: string; normalizedName: string; websiteUrl: string | null;
  entityType: EntityType; origin: EntityOrigin; relevanceStatus: RelevanceStatus; relevanceNote: string | null;
  createdAt: string; updatedAt: string; dismissedAt: string | null;
}
export interface MarketFinding {
  id: string; founderId: string; marketEntityId: string; sourceUrl: string; canonicalUrl: string | null;
  sourceTitle: string | null; sourceType: string; retrievedAt: string; retrievalAdapter: string; extractionVersion: string;
  observedText: string; evidenceFragmentId: string | null; inferenceText: string | null; epistemicStatus: EpistemicStatus;
  relevanceToFounder: string | null; founderResponse: FindingResponse; founderQualification: string | null;
  supersedesId: string | null; createdAt: string;
}

export function normalizeName(name: string): string { return name.trim().toLowerCase().replace(/\s+/g, ' '); }

// ── Provider-neutral adapter contract ─────────────────────────────────────────────────────────────────
export interface RetrievedPage { url: string; canonicalUrl: string | null; title: string | null; text: string; sourceType: string }
export interface RetrievalResult { pages: RetrievedPage[]; attempted: string[]; retrieved: string[]; skipped: string[]; blocked: string[] }

export interface ResearchAdapter {
  readonly name: string;                 // e.g. 'website-connector'
  readonly extractionVersion: string;
  readonly supportsDiscovery: boolean;   // website adapter = false (it never pretends to discover)
  /** Retrieve a KNOWN entity's permitted public pages. Throws for an unreachable/blocked host handled by caller. */
  retrieve(url: string): Promise<RetrievalResult>;
}

// ── Inference layer (separate from retrieval; bounded, never asserts market fact) ──────────────────────
export interface MarketInferenceInput { entityName: string; entityType: EntityType; observed: RetrievedPage[]; founderBusiness: string }
export interface MarketInferenceResult { inferenceText: string; epistemicStatus: EpistemicStatus; relevanceToFounder: string }
export interface MarketInferenceModel { readonly version: string; infer(input: MarketInferenceInput): Promise<MarketInferenceResult> }

/** Forbidden market claims — BB must not assert these from a company's own site. Guard is belt-and-suspenders
 *  over the prompt: a market-level inference is capped at HYPOTHESIS (never OBSERVED/SYNTHESIZED as fact). */
const FORBIDDEN = /\b(market share|demand|leading|leader\b|#1|number one|most popular|best[- ]selling|fastest[- ]growing|customers? prefer|higher conversion|proven results|award[- ]winning market)\b/i;
export function capMarketEpistemics(status: EpistemicStatus, inferenceText: string): EpistemicStatus {
  // If the inference reaches for a market-fact claim, it cannot be a demonstrated band.
  if (FORBIDDEN.test(inferenceText) && (status === 'OBSERVED' || status === 'SYNTHESIZED_FROM_OBSERVED')) return 'HYPOTHESIS';
  return status;
}
