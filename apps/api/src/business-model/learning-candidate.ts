/**
 * Wave 4 — Strategic Learning Origination Gate (ADR-017, V088 completion). A Learning Candidate is an append-only,
 * REVISIONED, immutable PROPOSAL that a retrospective (Strategic Outcome Review) might be worth keeping as a durable
 * learning. Editing creates a NEW revision (history immutable; no fork; a predecessor must be the immediately-preceding
 * revision of the SAME founder + logical candidate + source review). Each revision freezes: the exact source identity
 * (Outcome Review id + revision + snapshot id + content hash), the selected source observations, unknown + contradiction
 * markers, applicability scope, epistemic status, and the founder's own wording — plus a SHA-256 content hash so the whole
 * revision is reconstructable. Creating/editing produces NO learning and NO promotion. A candidate becomes a learning ONLY
 * via an explicit founder ADOPT of one EXACT revision; the founder may REJECT, WITHDRAW (terminal) or DEFER (non-terminal).
 *
 * Governed by docs/governance/strategic-learning-origination-gate-contract.md (Laws 1–12) + ADR-017 completion.
 */
import { createHash } from 'node:crypto';
import type { StrategicOutcomeReview } from './strategic-outcome-review';
import {
  LEARNING_CATEGORIES, LEARNING_CONFIDENCES, LEARNING_SCOPES, BROAD_SCOPES,
  type LearningCategory, type LearningConfidence, type LearningScope, type LearningInput,
} from './strategic-learning';

export const LEARNING_CANDIDATE_SCHEMA_VERSION = 'learning-candidate-2';
export const CANDIDATE_HASH_ALGORITHM = 'sha256';
export type CandidateVerdict = 'ADOPT' | 'REJECT' | 'DEFER' | 'WITHDRAW';
export const CANDIDATE_VERDICTS: ReadonlySet<string> = new Set(['ADOPT', 'REJECT', 'DEFER', 'WITHDRAW']);
export const TERMINAL_VERDICTS: ReadonlySet<string> = new Set(['ADOPT', 'REJECT', 'WITHDRAW']);
export type CandidateStatus = 'PROPOSED' | 'DEFERRED' | 'ADOPTED' | 'REJECTED' | 'WITHDRAWN';

export type LearningCandidateRejection =
  | 'OUTCOME_REVIEW_NOT_FOUND' | 'CANDIDATE_STATEMENT_REQUIRED' | 'FOUNDER_STATEMENT_REQUIRED' | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'SCOPE_REQUIRED' | 'EPISTEMIC_STATUS_REQUIRED' | 'CATEGORY_REQUIRED' | 'NARRATIVE_REQUIRED'
  | 'BROAD_SCOPE_NOT_ACKNOWLEDGED' | 'INVALID_OBSERVATION' | 'SOURCE_HASH_MISMATCH'
  | 'CANDIDATE_NOT_FOUND' | 'STALE_CANDIDATE_REVISION' | 'CANDIDATE_ALREADY_DECIDED' | 'INVALID_VERDICT' | 'JUDGMENT_REQUIRED'
  | 'CAUSAL_CLAIM_UNSUPPORTED' | 'EPISTEMIC_MARKERS_DROPPED';
export class LearningCandidateError extends Error {
  constructor(public readonly reason: LearningCandidateRejection, message: string) { super(message); this.name = 'LearningCandidateError'; }
}

/** A stable reference to an observation the founder SELECTED from the source Outcome Review (Law: selected observations). */
export interface SelectedObservation { kind: 'REPORTED' | 'EVIDENCE'; ref: string; statement: string }

/** Founder-supplied candidate content. A proposal, NOT a learning. Complete enough that an ADOPT derives the learning. */
export interface LearningCandidateInput {
  candidateStatement: string;         // the proposed durable learning (system-facing wording)
  founderStatement: string;           // the founder's OWN words (kept distinct — Law 9)
  priorUnderstanding: string; revisedUnderstanding: string; changeStatement: string;
  learningCategory: LearningCategory;
  applicabilityScope: LearningScope;  // how widely it applies
  epistemicStatus: LearningConfidence; // how settled (never "certain")
  isCausalHypothesis?: boolean; broadScopeAcknowledged?: boolean;
  selectedObservations?: SelectedObservation[];
  unknownMarkers?: string[];          // what remains unknown (preserved from the retrospective)
  contradictionMarkers?: string[];    // what cuts against it (preserved)
  candidateRationale?: string | null;
  expectedSourceHash?: string;        // fail closed if the source Outcome Review's content hash has changed
  idempotencyKey: string;
}

export interface LearningCandidate {
  id: string; founderId: string;
  logicalCandidateId: string; revision: number; predecessorCandidateId: string | null;
  outcomeReviewId: string; sourceOutcomeReviewRevision: number; sourceSnapshotId: string; outcomeReviewContentHash: string;
  planRecordId: string; planLogicalId: string; planRevision: number; commitmentRecordId: string;
  sourceObservedOutcome: string;
  candidateStatement: string; founderStatement: string; candidateRationale: string | null;
  priorUnderstanding: string; revisedUnderstanding: string; changeStatement: string;
  learningCategory: LearningCategory; applicabilityScope: LearningScope; epistemicStatus: LearningConfidence;
  isCausalHypothesis: boolean; broadScopeAcknowledged: boolean;
  selectedObservations: SelectedObservation[]; unknownMarkers: string[]; contradictionMarkers: string[];
  schemaVersion: string; contentHash: string; idempotencyKey: string; createdAt: string;
}

export interface LearningCandidateDecision {
  id: string; founderId: string; logicalCandidateId: string; candidateRevisionId: string;
  verdict: CandidateVerdict; founderJudgment: string; resultingLearningId: string | null;
  idempotencyKey: string; createdAt: string;
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter(Boolean).slice(0, 50).map((x) => x.slice(0, 2000)) : []);
function normalizeObservations(v: unknown): SelectedObservation[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 40).map((o) => { const r = (o ?? {}) as Record<string, unknown>; return { kind: (r['kind'] === 'EVIDENCE' ? 'EVIDENCE' : 'REPORTED') as 'REPORTED' | 'EVIDENCE', ref: s(r['ref']).slice(0, 200), statement: s(r['statement']).slice(0, 2000) }; }).filter((o) => o.ref);
}

/** SHA-256 over a canonical (sorted-key) serialization of the frozen candidate content — reproducible forever. */
export function canonicalCandidateSerialize(c: Omit<LearningCandidate, 'id' | 'founderId' | 'createdAt' | 'contentHash' | 'idempotencyKey'>): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') return Object.keys(v as Record<string, unknown>).sort().reduce((o, k) => { o[k] = sortKeys((v as Record<string, unknown>)[k]); return o; }, {} as Record<string, unknown>);
    return v;
  };
  return JSON.stringify(sortKeys(c));
}
export function computeCandidateContentHash(c: Omit<LearningCandidate, 'id' | 'founderId' | 'createdAt' | 'contentHash' | 'idempotencyKey'>): string {
  return createHash('sha256').update(canonicalCandidateSerialize(c)).digest('hex');
}

/** The set of observation refs the source Outcome Review actually contains (subject ids + evidence values). */
function outcomeReviewObservationRefs(sor: StrategicOutcomeReview): { reported: ReadonlySet<string>; evidence: ReadonlySet<string> } {
  const reported = new Set((sor.assessment?.reported ?? []).map((r) => r.subjectId));
  const evidence = new Set((sor.assessment?.evidence?.executionEvidence ?? []).map((e) => e.value));
  return { reported, evidence };
}

/** Validate founder candidate content against the exact source Outcome Review. Fail closed on source-hash mismatch (Law 8). */
export function assertCandidateAdmissible(sor: StrategicOutcomeReview | null, input: LearningCandidateInput): void {
  if (!sor) throw new LearningCandidateError('OUTCOME_REVIEW_NOT_FOUND', 'A learning candidate must come from an outcome review you own.');
  if (input.expectedSourceHash !== undefined && s(input.expectedSourceHash) !== sor.contentHash) throw new LearningCandidateError('SOURCE_HASH_MISMATCH', 'The outcome review changed — reload it before proposing a candidate.');
  if (!s(input.idempotencyKey)) throw new LearningCandidateError('IDEMPOTENCY_KEY_REQUIRED', 'A learning candidate requires an idempotency key.');
  if (!s(input.candidateStatement)) throw new LearningCandidateError('CANDIDATE_STATEMENT_REQUIRED', 'Say the learning this retrospective suggests — it stays a proposal until you accept it.');
  if (!s(input.founderStatement)) throw new LearningCandidateError('FOUNDER_STATEMENT_REQUIRED', 'Say it in your own words (kept separate from the proposed learning).');
  if (!s(input.priorUnderstanding) || !s(input.revisedUnderstanding) || !s(input.changeStatement)) throw new LearningCandidateError('NARRATIVE_REQUIRED', 'Say what you understood before, what you understand now, and what changed.');
  if (!input.learningCategory || !LEARNING_CATEGORIES.has(input.learningCategory)) throw new LearningCandidateError('CATEGORY_REQUIRED', 'Choose what this learning is about.');
  if (!input.applicabilityScope || !LEARNING_SCOPES.has(input.applicabilityScope)) throw new LearningCandidateError('SCOPE_REQUIRED', 'Choose how widely this learning applies.');
  if (!input.epistemicStatus || !LEARNING_CONFIDENCES.has(input.epistemicStatus)) throw new LearningCandidateError('EPISTEMIC_STATUS_REQUIRED', 'Choose how settled this is (never “certain”).');
  if (BROAD_SCOPES.has(input.applicabilityScope) && input.broadScopeAcknowledged !== true) throw new LearningCandidateError('BROAD_SCOPE_NOT_ACKNOWLEDGED', 'You’re generalizing beyond this retrospective — confirm that’s intended.');
  // a causal claim asserted as SUPPORTED with no selected observations may not stand (no unqualified causation).
  if (input.isCausalHypothesis === true && input.epistemicStatus === 'SUPPORTED' && normalizeObservations(input.selectedObservations).length === 0) {
    throw new LearningCandidateError('CAUSAL_CLAIM_UNSUPPORTED', 'A causal claim from your own reports alone can’t be “supported” — cite a selected observation, or mark it provisional.');
  }
  // every selected observation must actually exist in the source Outcome Review (no invented refs).
  const refs = outcomeReviewObservationRefs(sor);
  for (const o of normalizeObservations(input.selectedObservations)) {
    const ok = o.kind === 'REPORTED' ? refs.reported.has(o.ref) : refs.evidence.has(o.ref);
    if (!ok) throw new LearningCandidateError('INVALID_OBSERVATION', 'A selected observation must come from this outcome review.');
  }
}

function candidateContent(sor: StrategicOutcomeReview, input: LearningCandidateInput, logicalCandidateId: string, revision: number, predecessorCandidateId: string | null): Omit<LearningCandidate, 'id' | 'founderId' | 'createdAt' | 'contentHash' | 'idempotencyKey'> {
  return {
    logicalCandidateId, revision, predecessorCandidateId,
    outcomeReviewId: sor.id, sourceOutcomeReviewRevision: 1, sourceSnapshotId: sor.contextSnapshotId, outcomeReviewContentHash: sor.contentHash,
    planRecordId: sor.planRecordId, planLogicalId: sor.planLogicalId, planRevision: sor.planRevision, commitmentRecordId: sor.commitmentRecordId,
    sourceObservedOutcome: sor.observedOutcome,
    candidateStatement: s(input.candidateStatement).slice(0, 4000), founderStatement: s(input.founderStatement).slice(0, 4000),
    candidateRationale: s(input.candidateRationale) ? s(input.candidateRationale).slice(0, 4000) : null,
    priorUnderstanding: s(input.priorUnderstanding).slice(0, 4000), revisedUnderstanding: s(input.revisedUnderstanding).slice(0, 4000), changeStatement: s(input.changeStatement).slice(0, 4000),
    learningCategory: input.learningCategory, applicabilityScope: input.applicabilityScope, epistemicStatus: input.epistemicStatus,
    isCausalHypothesis: input.isCausalHypothesis === true, broadScopeAcknowledged: input.broadScopeAcknowledged === true,
    selectedObservations: normalizeObservations(input.selectedObservations), unknownMarkers: strList(input.unknownMarkers), contradictionMarkers: strList(input.contradictionMarkers),
    schemaVersion: LEARNING_CANDIDATE_SCHEMA_VERSION,
  };
}

/** Build revision-1 fields (its own logical thread root). */
export function buildCandidateFields(sor: StrategicOutcomeReview, input: LearningCandidateInput, logicalCandidateId: string): Omit<LearningCandidate, 'id' | 'founderId' | 'createdAt' | 'idempotencyKey'> {
  const content = candidateContent(sor, input, logicalCandidateId, 1, null);
  return { ...content, contentHash: computeCandidateContentHash(content) };
}
/** Build revision N+1 fields when the founder EDITS a candidate (history stays immutable). Source freeze carried from pred. */
export function buildCandidateRevisionFields(sor: StrategicOutcomeReview, input: LearningCandidateInput, pred: LearningCandidate): Omit<LearningCandidate, 'id' | 'founderId' | 'createdAt' | 'idempotencyKey'> {
  const content = candidateContent(sor, input, pred.logicalCandidateId, pred.revision + 1, pred.id);
  return { ...content, contentHash: computeCandidateContentHash(content) };
}

/** Assert an explicit judgment on a candidate thread. Exactly one TERMINAL (ADOPT/REJECT/WITHDRAW); DEFER is repeatable. */
export function assertJudgmentAdmissible(existingTerminal: LearningCandidateDecision | null, verdict: string, founderJudgment: string, idempotencyKey: string): void {
  if (!s(idempotencyKey)) throw new LearningCandidateError('IDEMPOTENCY_KEY_REQUIRED', 'A judgment requires an idempotency key.');
  if (!CANDIDATE_VERDICTS.has(verdict)) throw new LearningCandidateError('INVALID_VERDICT', 'Choose adopt, reject, defer, or withdraw.');
  if (!s(founderJudgment)) throw new LearningCandidateError('JUDGMENT_REQUIRED', 'Say, in your words, why.');
  if (existingTerminal) throw new LearningCandidateError('CANDIDATE_ALREADY_DECIDED', 'You already made a final decision on this candidate — it cannot be decided again.');
}

/** Effective status from the append-only judgment log: a terminal verdict wins; else DEFERRED if any DEFER; else PROPOSED. */
export function deriveCandidateStatus(decisions: LearningCandidateDecision[]): CandidateStatus {
  const terminal = decisions.find((d) => TERMINAL_VERDICTS.has(d.verdict));
  if (terminal) return terminal.verdict === 'ADOPT' ? 'ADOPTED' : terminal.verdict === 'REJECT' ? 'REJECTED' : 'WITHDRAWN';
  return decisions.some((d) => d.verdict === 'DEFER') ? 'DEFERRED' : 'PROPOSED';
}

/**
 * Derive the LearningInput for an ADOPT DETERMINISTICALLY from the exact candidate revision — so the admitted learning
 * RETAINS the candidate's selected observations, unknowns, contradictions, scope, and epistemic status (never silently
 * dropped or strengthened). No separate founder re-entry; the founder authored all of this on the candidate.
 */
export function buildLearningInputFromCandidate(candidate: LearningCandidate, idempotencyKey: string): LearningInput {
  return {
    learningStatement: candidate.candidateStatement, learningCategory: candidate.learningCategory, confidence: candidate.epistemicStatus,
    priorUnderstanding: candidate.priorUnderstanding, revisedUnderstanding: candidate.revisedUnderstanding, changeStatement: candidate.changeStatement,
    learningScope: candidate.applicabilityScope, broadScopeAcknowledged: candidate.broadScopeAcknowledged, isCausalHypothesis: candidate.isCausalHypothesis,
    boundaryConditions: [], counterEvidence: candidate.contradictionMarkers, unresolvedUnknowns: candidate.unknownMarkers,
    observations: candidate.selectedObservations.map((o) => ({ statement: o.statement || o.ref, sourceType: 'FOUNDER_REPORTED' as const })),
    evidenceReferences: [], idempotencyKey,
  };
}

/** Founder-safe view — explicit that a candidate is a proposal, produces nothing until adopted, never promotes. */
export function toCandidateView(candidate: LearningCandidate, decisions: LearningCandidateDecision[]) {
  const status = deriveCandidateStatus(decisions);
  const terminal = decisions.find((d) => TERMINAL_VERDICTS.has(d.verdict)) ?? null;
  return {
    candidateId: candidate.id, logicalCandidateId: candidate.logicalCandidateId, revision: candidate.revision, predecessorCandidateId: candidate.predecessorCandidateId,
    source: { outcomeReviewId: candidate.outcomeReviewId, outcomeReviewRevision: candidate.sourceOutcomeReviewRevision, snapshotId: candidate.sourceSnapshotId, contentHash: candidate.outcomeReviewContentHash },
    plan: { recordId: candidate.planRecordId, logicalId: candidate.planLogicalId, revision: candidate.planRevision },
    sourceObservedOutcome: candidate.sourceObservedOutcome,
    candidateStatement: candidate.candidateStatement, founderStatement: candidate.founderStatement, candidateRationale: candidate.candidateRationale,
    priorUnderstanding: candidate.priorUnderstanding, revisedUnderstanding: candidate.revisedUnderstanding, changeStatement: candidate.changeStatement,
    learningCategory: candidate.learningCategory, applicabilityScope: candidate.applicabilityScope, epistemicStatus: candidate.epistemicStatus,
    isCausalHypothesis: candidate.isCausalHypothesis,
    selectedObservations: candidate.selectedObservations, unknownMarkers: candidate.unknownMarkers, contradictionMarkers: candidate.contradictionMarkers,
    contentHash: candidate.contentHash, createdAt: candidate.createdAt,
    status,
    judgments: decisions.map((d) => ({ verdict: d.verdict, founderJudgment: d.founderJudgment, resultingLearningId: d.resultingLearningId, decidedAt: d.createdAt, revisionJudged: d.candidateRevisionId })),
    terminalDecision: terminal ? { verdict: terminal.verdict, resultingLearningId: terminal.resultingLearningId } : null,
    // constant reminders (Laws 4, 6, 7)
    isProposalNotLearning: true, createsNothingUntilAdopted: true, neverAutoPromotes: true,
  };
}
