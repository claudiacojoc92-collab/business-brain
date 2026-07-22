/**
 * Wave 4 — Strategic Learning Origination Gate (ADR-017). A Learning Candidate is an append-only, immutable PROPOSAL that a
 * retrospective (Strategic Outcome Review) might be worth keeping as a durable learning. Creating a candidate produces NO
 * Strategic Learning and NO Promotion; it becomes a learning ONLY via an explicit founder judgment (ACCEPT) — the founder
 * may instead DISMISS. Exactly one decision per candidate (no-fork). This is the ONLY path by which an Outcome Review may
 * feed learning; the Plan Review path is separate and unchanged; there is no generic Review→Learning source.
 *
 * Governed by docs/governance/strategic-learning-origination-gate-contract.md (Laws 1–12).
 */
import type { StrategicOutcomeReview } from './strategic-outcome-review';

export const LEARNING_CANDIDATE_SCHEMA_VERSION = 'learning-candidate-1';
export type CandidateVerdict = 'ACCEPT' | 'DISMISS';
export const CANDIDATE_VERDICTS: ReadonlySet<string> = new Set(['ACCEPT', 'DISMISS']);
export type CandidateStatus = 'PROPOSED' | 'ACCEPTED' | 'DISMISSED';

export type LearningCandidateRejection =
  | 'OUTCOME_REVIEW_NOT_FOUND' | 'CANDIDATE_STATEMENT_REQUIRED' | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'CANDIDATE_NOT_FOUND' | 'CANDIDATE_ALREADY_DECIDED' | 'INVALID_VERDICT' | 'JUDGMENT_REQUIRED';
export class LearningCandidateError extends Error {
  constructor(public readonly reason: LearningCandidateRejection, message: string) { super(message); this.name = 'LearningCandidateError'; }
}

/** Founder-supplied proposal. A proposal, NOT a learning (Law 4). No promotion, no lifecycle. */
export interface LearningCandidateInput {
  candidateStatement: string;
  candidateRationale?: string | null;
  idempotencyKey: string;
}

export interface LearningCandidate {
  id: string; founderId: string;
  outcomeReviewId: string; outcomeReviewContentHash: string;
  planRecordId: string; planLogicalId: string; planRevision: number; commitmentRecordId: string;
  sourceObservedOutcome: string;
  candidateStatement: string; candidateRationale: string | null;
  schemaVersion: string; idempotencyKey: string; createdAt: string;
}

/** The explicit, one-time founder judgment on a candidate (Law 5). */
export interface LearningCandidateDecision {
  id: string; founderId: string; candidateId: string;
  verdict: CandidateVerdict; founderJudgment: string; resultingLearningId: string | null;
  idempotencyKey: string; createdAt: string;
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Deterministically assert a candidate may be proposed from this exact owned Outcome Review + input. Throws. */
export function assertCandidateAdmissible(outcomeReview: StrategicOutcomeReview | null, input: LearningCandidateInput): void {
  if (!outcomeReview) throw new LearningCandidateError('OUTCOME_REVIEW_NOT_FOUND', 'A learning candidate must come from an outcome review you own.');
  if (!s(input.idempotencyKey)) throw new LearningCandidateError('IDEMPOTENCY_KEY_REQUIRED', 'A learning candidate requires an idempotency key.');
  if (!s(input.candidateStatement)) throw new LearningCandidateError('CANDIDATE_STATEMENT_REQUIRED', 'Say, in your words, the learning this retrospective suggests — it stays a proposal until you accept it.');
}

/** Freeze the candidate's provenance + lineage from the exact Outcome Review (Law 8). No model, no inference. */
export function buildCandidateFields(outcomeReview: StrategicOutcomeReview, input: LearningCandidateInput): Omit<LearningCandidate, 'id' | 'founderId' | 'createdAt'> {
  return {
    outcomeReviewId: outcomeReview.id, outcomeReviewContentHash: outcomeReview.contentHash,
    planRecordId: outcomeReview.planRecordId, planLogicalId: outcomeReview.planLogicalId, planRevision: outcomeReview.planRevision,
    commitmentRecordId: outcomeReview.commitmentRecordId, sourceObservedOutcome: outcomeReview.observedOutcome,
    candidateStatement: s(input.candidateStatement).slice(0, 4000), candidateRationale: s(input.candidateRationale) ? s(input.candidateRationale).slice(0, 4000) : null,
    schemaVersion: LEARNING_CANDIDATE_SCHEMA_VERSION, idempotencyKey: s(input.idempotencyKey).slice(0, 200),
  };
}

/** Assert an explicit judgment. ACCEPT requires the learning input downstream; both require a founder statement. */
export function assertDecisionAdmissible(existing: LearningCandidateDecision | null, verdict: string, founderJudgment: string, idempotencyKey: string): void {
  if (!s(idempotencyKey)) throw new LearningCandidateError('IDEMPOTENCY_KEY_REQUIRED', 'A judgment requires an idempotency key.');
  if (!CANDIDATE_VERDICTS.has(verdict)) throw new LearningCandidateError('INVALID_VERDICT', 'Choose accept or dismiss.');
  if (!s(founderJudgment)) throw new LearningCandidateError('JUDGMENT_REQUIRED', 'Say, in your words, why you’re accepting or dismissing this.');
  if (existing) throw new LearningCandidateError('CANDIDATE_ALREADY_DECIDED', 'You already decided on this candidate — it cannot be decided again.');
}

/** Effective status of a candidate from its (at most one) decision (Law 5). */
export function deriveCandidateStatus(decision: LearningCandidateDecision | null): CandidateStatus {
  if (!decision) return 'PROPOSED';
  return decision.verdict === 'ACCEPT' ? 'ACCEPTED' : 'DISMISSED';
}

/** Founder-safe view — makes explicit that a candidate is a proposal, produces nothing until accepted, never promotes. */
export function toCandidateView(candidate: LearningCandidate, decision: LearningCandidateDecision | null) {
  const status = deriveCandidateStatus(decision);
  return {
    candidateId: candidate.id, outcomeReviewId: candidate.outcomeReviewId, outcomeReviewContentHash: candidate.outcomeReviewContentHash,
    plan: { recordId: candidate.planRecordId, logicalId: candidate.planLogicalId, revision: candidate.planRevision },
    sourceObservedOutcome: candidate.sourceObservedOutcome,
    candidateStatement: candidate.candidateStatement, candidateRationale: candidate.candidateRationale,
    status,
    decision: decision ? { verdict: decision.verdict, founderJudgment: decision.founderJudgment, resultingLearningId: decision.resultingLearningId, decidedAt: decision.createdAt } : null,
    createdAt: candidate.createdAt,
    // constant reminders (Laws 4, 6, 7)
    isProposalNotLearning: true, createsNothingUntilAccepted: true, neverAutoPromotes: true,
  };
}
