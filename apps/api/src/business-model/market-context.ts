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
/** Legacy per-finding column (V061) — retained on the row but NO LONGER the source of truth for founder
 *  judgment; findings are always appended 'unreviewed'. Accuracy + relevance now live in market_finding_response. */
export type FindingResponse = 'unreviewed' | 'confirmed' | 'dismissed' | 'qualified';
export type EpistemicStatus = 'OBSERVED' | 'SYNTHESIZED_FROM_OBSERVED' | 'HYPOTHESIS' | 'NEEDS_MORE_EVIDENCE';

// ── Two INDEPENDENT founder judgments per finding (never collapsed into one status) ────────────────────────
/** Source accuracy — "does this accurately reflect what the public source says?" Concerns BB's READING of the
 *  source, NOT whether the source's claim is true in the market. */
export type AccuracyStatus = 'unreviewed' | 'yes' | 'partly' | 'no';
/** Business relevance — "does this matter for understanding my business / competitive context?" */
export type RelevanceResponseStatus = 'unreviewed' | 'relevant' | 'partly_relevant' | 'not_relevant';
export const ACCURACY_STATUSES: ReadonlySet<string> = new Set(['unreviewed', 'yes', 'partly', 'no']);
export const RELEVANCE_RESPONSE_STATUSES: ReadonlySet<string> = new Set(['unreviewed', 'relevant', 'partly_relevant', 'not_relevant']);

export interface FindingResponseRecord {
  id: string; founderId: string; marketFindingId: string;
  accuratelyReflectsSource: AccuracyStatus; relevanceStatus: RelevanceResponseStatus;
  accuracyQualification: string | null; relevanceQualification: string | null;
  supersedesId: string | null; supersededAt: string | null; createdAt: string;
}

/** Deterministic effective-orchestration classification for one finding given its effective response.
 *  Accuracy (BB's reading of the source) and relevance (strategic usefulness) are INDEPENDENT:
 *   - accuracy 'no'                     → excluded (BB misread the source; not usable context)
 *   - relevance 'not_relevant'          → excluded (founder says it doesn't matter strategically)
 *   - relevance relevant/partly_relevant→ usable   (should influence later orchestration)
 *   - relevance 'unreviewed'            → provisional (available only as clearly provisional context)
 *  accuracy 'no' NEVER dismisses the entity; relevance 'not_relevant' NEVER marks the source observation false. */
export type FindingUsability = 'usable' | 'provisional' | 'excluded';
export function classifyFindingUsability(resp: { accuratelyReflectsSource: AccuracyStatus; relevanceStatus: RelevanceResponseStatus } | null): FindingUsability {
  const acc = resp?.accuratelyReflectsSource ?? 'unreviewed';
  const rel = resp?.relevanceStatus ?? 'unreviewed';
  if (acc === 'no') return 'excluded';
  if (rel === 'not_relevant') return 'excluded';
  if (rel === 'relevant' || rel === 'partly_relevant') return 'usable';
  return 'provisional';
}

export const ENTITY_TYPES: ReadonlySet<string> = new Set(['direct', 'indirect', 'alternative', 'reference']);

export interface MarketEntity {
  id: string; founderId: string; name: string; normalizedName: string; websiteUrl: string | null;
  entityType: EntityType; origin: EntityOrigin; relevanceStatus: RelevanceStatus; relevanceNote: string | null;
  createdAt: string; updatedAt: string; dismissedAt: string | null;
}
export interface MarketFinding {
  id: string; founderId: string; marketEntityId: string; reviewId: string | null; sourceUrl: string; canonicalUrl: string | null;
  sourceTitle: string | null; sourceType: string; retrievedAt: string; retrievalAdapter: string; extractionVersion: string;
  observedText: string; evidenceFragmentId: string | null; inferenceText: string | null; epistemicStatus: EpistemicStatus;
  relevanceToFounder: string | null; founderResponse: FindingResponse; founderQualification: string | null;
  supersedesId: string | null; createdAt: string;
}

/** Precise retrieval failure taxonomy — never collapse all empty-source cases into one generic failure. */
export type FailureCategory = 'ROBOTS_BLOCKED' | 'UNREACHABLE' | 'UNSUPPORTED_CONTENT' | 'INSUFFICIENT_READABLE_EVIDENCE' | 'RETRIEVAL_FAILED' | 'INFERENCE_FAILED';
export type PageOutcome = 'retrieved' | 'blocked' | 'unreachable' | 'unsupported' | 'empty';

export function normalizeName(name: string): string { return name.trim().toLowerCase().replace(/\s+/g, ' '); }

// ── Provider-neutral adapter contract ─────────────────────────────────────────────────────────────────
export interface RetrievedPage { url: string; canonicalUrl: string | null; title: string | null; text: string; sourceType: string }
export interface RetrievalResult { pages: RetrievedPage[]; attempted: string[]; retrieved: string[]; skipped: string[]; blocked: string[]; outcomes: Array<{ url: string; outcome: PageOutcome }> }

/** Classify an empty retrieval into a precise category, or null when there ARE readable pages. */
export function classifyRetrieval(r: RetrievalResult): FailureCategory | null {
  if (r.pages.length > 0) return null;
  const kinds = new Set(r.outcomes.map((o) => o.outcome));
  if (r.outcomes.length > 0 && r.outcomes.every((o) => o.outcome === 'blocked')) return 'ROBOTS_BLOCKED';
  if (kinds.has('unsupported') && !kinds.has('empty')) return 'UNSUPPORTED_CONTENT';
  if (kinds.has('unreachable') && !kinds.has('empty')) return 'UNREACHABLE';
  if (kinds.has('empty')) return 'INSUFFICIENT_READABLE_EVIDENCE';   // fetched but nothing readable
  if (kinds.has('blocked')) return 'ROBOTS_BLOCKED';
  return 'UNREACHABLE';                                              // nothing reached at all
}

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
