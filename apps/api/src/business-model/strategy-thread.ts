/**
 * Show Me the Loop (product milestone) — the Strategy Thread is a NON-CANONICAL, deterministic READ PROJECTION over accepted
 * canonical records: session → decision → commitment → plan revisions → execution reports → outcome reviews → candidate
 * revisions → strategic learnings → promotions → later recommendations whose FROZEN context snapshot included a promoted
 * learning from this thread. It persists NOTHING, calls NO model, and invents NO relationship — where an exact link is
 * absent it reports `SOURCE_RELATIONSHIP_UNAVAILABLE`. Governed by docs/product/show-me-the-loop-contract.md (L1–L10).
 */
export const SOURCE_UNAVAILABLE = 'Source relationship unavailable';
/** Bounded future-recommendation wording (L6) — never causal. */
export const USAGE_DISCLOSURE = 'This recommendation was generated with a context snapshot that included this promoted learning.';

export interface ThreadRecommendation { sessionId: string; title: string; question: string; status: string; createdAt: string; snapshotId: string | null; snapshotHash: string | null }
export interface ThreadDecision { id: string; logicalId: string; revision: number; statement: string; createdAt: string; fromRecommendationSessionId: string | null }
export interface ThreadCommitment { id: string; logicalId: string; revision: number; statement: string; createdAt: string; fromDecisionId: string | null }
export interface ThreadExecutionReport { subjectId: string; reportedState: string; statement: string | null; reportedAt: string | null }
export interface ThreadPromotion { promotionEventId: string; target: string; action: string; learningRevisionId: string; at: string }
export interface ThreadLearning {
  learningId: string; logicalLearningId: string; origin: 'PLAN_REVIEW' | 'OUTCOME_REVIEW'; statement: string; scope: string; confidence: string; createdAt: string;
  fromCandidateRevisionId: string | null; fromOutcomeReviewId: string | null; fromPlanReviewId: string | null;
  promotions: ThreadPromotion[]; promoted: boolean;
}
export interface ThreadCandidate {
  logicalCandidateId: string; headRevisionId: string; revision: number; statement: string; status: 'PROPOSED' | 'DEFERRED' | 'ADOPTED' | 'REJECTED' | 'WITHDRAWN';
  unknowns: string[]; contradictions: string[]; createdAt: string; fromOutcomeReviewId: string;
  learningId: string | null;
}
export interface ThreadOutcomeReview {
  reviewId: string; observedOutcome: string; statement: string; unknowns: string[]; createdAt: string; fromPlanRecordId: string; contextSnapshotId: string;
  candidates: ThreadCandidate[];
}
export interface ThreadPlan {
  planId: string; logicalPlanId: string; revision: number; title: string; status: string; createdAt: string; fromCommitmentId: string | null;
  executionReports: ThreadExecutionReport[]; outcomeReviews: ThreadOutcomeReview[];
}
export interface ThreadLaterRecommendation { sessionId: string; title: string; question: string; createdAt: string; includedLearningId: string; includedLogicalLearningId: string; includedLearningStatement: string; contextSnapshotId: string; disclosure: string }

export interface StrategyThreadView {
  rootSessionId: string;
  recommendation: ThreadRecommendation | null;
  decision: ThreadDecision | null;
  commitment: ThreadCommitment | null;
  plans: ThreadPlan[];
  learnings: ThreadLearning[];
  usedInLaterRecommendations: ThreadLaterRecommendation[];
  // explicit provenance-availability flags for the founder-facing "unavailable" copy (L5)
  provenanceAvailable: { decision: boolean; commitment: boolean; plan: boolean };
  isProjectionNotCanonical: true;
}
