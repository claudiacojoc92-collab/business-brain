/**
 * Wave 4 — Strategic Learning Lifecycle (ADR-012, single-thread; inter-thread relationships deferred). Deterministic,
 * founder-driven transitions CREATE → REFINE / CONTEST / SUPERSEDE / RETIRE, each appending a new IMMUTABLE full-record
 * revision of ONE logical thread. No model, no similarity, no relationship object, no knowledge graph.
 *
 * Governed by docs/governance/strategic-learning-lifecycle-contract.md (28 laws).
 */
import {
  LEARNING_CATEGORIES, LEARNING_CONFIDENCES, LEARNING_SCOPES, BROAD_SCOPES, OBSERVATION_SOURCES, deriveLifecycleStatus,
  type StrategicLearningRecord, type LearningLifecycleAction, type LearningCategory, type LearningConfidence,
  type LearningScope, type LearningObservation, type LearningEvidenceReference,
} from './strategic-learning';

export type { LearningLifecycleAction, LearningLifecycleStatus } from './strategic-learning';
export { deriveLifecycleStatus } from './strategic-learning';

// The set of ids a revision's evidence references may point to — the thread's own immutable lineage (Law 5).
export function learningLineageIds(rec: StrategicLearningRecord): ReadonlySet<string> {
  return new Set([rec.reviewRecordId, rec.planRecordId, rec.commitmentRecordId, rec.decisionRecordId, rec.recommendationSessionId, rec.provenanceManifestVersion].filter((x): x is string => typeof x === 'string' && x.length > 0));
}

export interface LifecycleTransitionInput {
  sourceRevisionId: string;       // exact current effective revision id (founder confirmation of target)
  expectedRevision: number;       // expected current revision number (optimistic concurrency / no-fork)
  idempotencyKey: string;
  lifecycleReason: string;        // founder rationale for the transition (required for every non-CREATE act)
  confirmSameLearning?: boolean;  // REFINE / SUPERSEDE require the founder to confirm the same underlying learning
  // content (any subset overrides the predecessor; REFINE/SUPERSEDE/CONTEST as governed)
  learningStatement?: string; learningCategory?: LearningCategory; confidence?: LearningConfidence;
  priorUnderstanding?: string; revisedUnderstanding?: string; changeStatement?: string;
  learningScope?: LearningScope; broadScopeAcknowledged?: boolean; isCausalHypothesis?: boolean;
  boundaryConditions?: string[]; counterEvidence?: string[]; unresolvedUnknowns?: string[];
  observations?: LearningObservation[]; evidenceReferences?: LearningEvidenceReference[];
  // CONTEST
  contestBasisExplanation?: string;
  // SUPERSEDE
  replacementSummary?: string; retainedValidity?: string;
  // Laws 14/15 — explicit explanations when prior counterevidence/unknowns are dropped
  counterevidenceResolution?: string; unknownsResolution?: string;
}

export type LifecycleRejection =
  | 'RATIONALE_REQUIRED' | 'IDEMPOTENCY_KEY_REQUIRED' | 'STALE_PREDECESSOR' | 'THREAD_RETIRED' | 'INVALID_ACTION'
  | 'NOOP_REFINE' | 'SAME_LEARNING_NOT_CONFIRMED' | 'BROAD_SCOPE_NOT_ACKNOWLEDGED' | 'CAUSAL_CLAIM_UNSUPPORTED'
  | 'OBSERVATION_INVALID' | 'EVIDENCE_NOT_IN_LINEAGE' | 'EVIDENCE_DUPLICATE'
  | 'CONTEST_POSITION_REQUIRED' | 'CONTEST_BASIS_REQUIRED'
  | 'REPLACEMENT_STATEMENT_REQUIRED' | 'REPLACEMENT_EXPLANATION_REQUIRED' | 'RETAINED_VALIDITY_REQUIRED'
  | 'COUNTEREVIDENCE_DROP_UNEXPLAINED' | 'UNKNOWNS_DROP_UNEXPLAINED';
export class LearningLifecycleError extends Error {
  constructor(public readonly reason: LifecycleRejection, message: string, public readonly conflict = false) { super(message); this.name = 'LearningLifecycleError'; }
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => s(x)).filter(Boolean) : []);
const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameObs = (a: LearningObservation[], b: LearningObservation[]) => a.length === b.length && a.every((o, i) => o.statement === b[i]!.statement && o.sourceType === b[i]!.sourceType);
const sameRefs = (a: LearningEvidenceReference[], b: LearningEvidenceReference[]) => a.length === b.length && a.every((o, i) => o.id === b[i]!.id && o.space === b[i]!.space);

/** Effective (current) revision of one logical thread = the highest revision number. Deterministic (Law 22). */
export function getEffectiveRevision(revisions: StrategicLearningRecord[]): StrategicLearningRecord {
  if (!revisions.length) throw new LearningLifecycleError('STALE_PREDECESSOR', 'No revisions for this learning thread.');
  return [...revisions].sort((x, y) => x.revision - y.revision)[revisions.length - 1]!;
}

/** Assert the thread is a contiguous 1..N chain: one CREATE root, each predecessor the exact prior id. */
export function assertContiguousChain(revisions: StrategicLearningRecord[]): void {
  const ordered = [...revisions].sort((x, y) => x.revision - y.revision);
  ordered.forEach((r, i) => {
    if (r.revision !== i + 1) throw new LearningLifecycleError('STALE_PREDECESSOR', 'Revision numbers are not contiguous.');
    if (i === 0) { if (r.lifecycleAction !== 'CREATE' || r.predecessorLearningId !== null) throw new LearningLifecycleError('STALE_PREDECESSOR', 'The first revision must be a CREATE with no predecessor.'); }
    else if (r.predecessorLearningId !== ordered[i - 1]!.id) throw new LearningLifecycleError('STALE_PREDECESSOR', 'A revision does not point to its exact predecessor.');
    if (r.rootLearningId !== ordered[0]!.id) throw new LearningLifecycleError('STALE_PREDECESSOR', 'Root learning id is not stable across the thread.');
  });
}

/** Merge the predecessor content with any founder overrides → the content the new revision would carry. */
function mergedContent(pred: StrategicLearningRecord, input: LifecycleTransitionInput) {
  return {
    learningStatement: input.learningStatement !== undefined ? s(input.learningStatement) : pred.learningStatement,
    learningCategory: input.learningCategory ?? pred.learningCategory,
    confidence: input.confidence ?? pred.confidence,
    priorUnderstanding: input.priorUnderstanding !== undefined ? s(input.priorUnderstanding) : pred.priorUnderstanding,
    revisedUnderstanding: input.revisedUnderstanding !== undefined ? s(input.revisedUnderstanding) : pred.revisedUnderstanding,
    changeStatement: input.changeStatement !== undefined ? s(input.changeStatement) : pred.changeStatement,
    learningScope: input.learningScope ?? pred.learningScope,
    broadScopeAcknowledged: input.broadScopeAcknowledged !== undefined ? input.broadScopeAcknowledged === true : pred.broadScopeAcknowledged,
    isCausalHypothesis: input.isCausalHypothesis !== undefined ? input.isCausalHypothesis === true : pred.isCausalHypothesis,
    boundaryConditions: input.boundaryConditions !== undefined ? arr(input.boundaryConditions) : pred.boundaryConditions,
    counterEvidence: input.counterEvidence !== undefined ? arr(input.counterEvidence) : pred.counterEvidence,
    unresolvedUnknowns: input.unresolvedUnknowns !== undefined ? arr(input.unresolvedUnknowns) : pred.unresolvedUnknowns,
    observations: input.observations !== undefined ? input.observations.map((o) => ({ statement: s(o.statement), sourceType: o.sourceType })) : pred.observations,
    evidenceReferences: input.evidenceReferences !== undefined ? input.evidenceReferences.map((e) => ({ space: s(e.space), id: s(e.id) })) : pred.evidenceReferences,
  };
}

/** Shared content guards (scope acknowledgement, causal guard, observation/evidence validity) on the MERGED content. */
function assertContentGuards(pred: StrategicLearningRecord, m: ReturnType<typeof mergedContent>): void {
  if (!LEARNING_CATEGORIES.has(m.learningCategory)) throw new LearningLifecycleError('INVALID_ACTION', 'Unknown learning category.');
  if (!LEARNING_CONFIDENCES.has(m.confidence)) throw new LearningLifecycleError('INVALID_ACTION', 'Unknown confidence.');
  if (!LEARNING_SCOPES.has(m.learningScope)) throw new LearningLifecycleError('INVALID_ACTION', 'Unknown scope.');
  // Law 16 — broadening scope to a broad category (that the predecessor was not already) requires acknowledgement.
  if (BROAD_SCOPES.has(m.learningScope) && !BROAD_SCOPES.has(pred.learningScope) && m.broadScopeAcknowledged !== true) {
    throw new LearningLifecycleError('BROAD_SCOPE_NOT_ACKNOWLEDGED', 'You’re generalizing this learning beyond its source — confirm that’s intended.');
  }
  for (const o of m.observations) if (!o.statement || !OBSERVATION_SOURCES.has(o.sourceType)) throw new LearningLifecycleError('OBSERVATION_INVALID', 'Each observation needs a statement and a valid source.');
  const lineage = learningLineageIds(pred); const seen = new Set<string>();
  for (const e of m.evidenceReferences) {
    if (!e.id || !lineage.has(e.id)) throw new LearningLifecycleError('EVIDENCE_NOT_IN_LINEAGE', 'An evidence reference must be part of this learning’s own lineage.');
    if (seen.has(e.id)) throw new LearningLifecycleError('EVIDENCE_DUPLICATE', 'That evidence reference is listed twice.');
    seen.add(e.id);
  }
  // Law 17 — a causal claim supported only by founder-reported material may not claim SUPPORTED.
  if (m.isCausalHypothesis && m.confidence === 'SUPPORTED' && m.evidenceReferences.length === 0) {
    throw new LearningLifecycleError('CAUSAL_CLAIM_UNSUPPORTED', 'A causal claim from your own reports alone can’t be “supported” — cite governed evidence, or mark it provisional.');
  }
}

/** Laws 14/15 — dropping prior counterevidence / unknowns requires an explicit founder explanation. */
function assertNoSilentDrops(pred: StrategicLearningRecord, m: ReturnType<typeof mergedContent>, input: LifecycleTransitionInput): void {
  const droppedCounter = pred.counterEvidence.some((c) => !m.counterEvidence.includes(c));
  if (droppedCounter && !s(input.counterevidenceResolution)) throw new LearningLifecycleError('COUNTEREVIDENCE_DROP_UNEXPLAINED', 'You removed earlier counter-evidence — explain how or why it no longer applies.');
  const droppedUnknown = pred.unresolvedUnknowns.some((u) => !m.unresolvedUnknowns.includes(u));
  if (droppedUnknown && !s(input.unknownsResolution)) throw new LearningLifecycleError('UNKNOWNS_DROP_UNEXPLAINED', 'You removed earlier unresolved unknowns — explain how or why they were resolved.');
}

/**
 * Deterministically validate a lifecycle transition against the EXACT current effective revision. Throws
 * LearningLifecycleError (conflict=true for stale/terminal). No model, no similarity.
 */
export function validateLifecycleTransition(action: Exclude<LearningLifecycleAction, 'CREATE'>, current: StrategicLearningRecord, input: LifecycleTransitionInput): void {
  if (!s(input.idempotencyKey)) throw new LearningLifecycleError('IDEMPOTENCY_KEY_REQUIRED', 'A lifecycle action requires an idempotency key.');
  // no-fork / stale-write (Law 23): the founder must target the exact current effective revision.
  if (input.sourceRevisionId !== current.id || Number(input.expectedRevision) !== current.revision) {
    throw new LearningLifecycleError('STALE_PREDECESSOR', 'This learning changed since you loaded it. Reload and try again.', true);
  }
  // RETIRE is terminal (Law 9): no further action on a retired thread.
  if (deriveLifecycleStatus(current.lifecycleAction) === 'RETIRED') throw new LearningLifecycleError('THREAD_RETIRED', 'This learning is retired. Record a new learning instead.', true);
  if (!s(input.lifecycleReason)) throw new LearningLifecycleError('RATIONALE_REQUIRED', 'Say, in your words, why you’re making this change.');
  const m = mergedContent(current, input);

  if (action === 'REFINE') {
    if (input.confirmSameLearning !== true) throw new LearningLifecycleError('SAME_LEARNING_NOT_CONFIRMED', 'Confirm this is still the same underlying learning (otherwise record a separate learning).');
    assertContentGuards(current, m);
    assertNoSilentDrops(current, m, input);
    const noChange = m.learningStatement === current.learningStatement && m.learningCategory === current.learningCategory && m.confidence === current.confidence
      && m.priorUnderstanding === current.priorUnderstanding && m.revisedUnderstanding === current.revisedUnderstanding && m.changeStatement === current.changeStatement
      && m.learningScope === current.learningScope && m.broadScopeAcknowledged === current.broadScopeAcknowledged && m.isCausalHypothesis === current.isCausalHypothesis
      && sameArr(m.boundaryConditions, current.boundaryConditions) && sameArr(m.counterEvidence, current.counterEvidence) && sameArr(m.unresolvedUnknowns, current.unresolvedUnknowns)
      && sameObs(m.observations, current.observations) && sameRefs(m.evidenceReferences, current.evidenceReferences);
    if (noChange) throw new LearningLifecycleError('NOOP_REFINE', 'A refine must change something — clarify wording, scope, evidence, boundaries, or certainty.');
    return;
  }
  if (action === 'CONTEST') {
    if (!s(m.revisedUnderstanding)) throw new LearningLifecycleError('CONTEST_POSITION_REQUIRED', 'Say where you now stand on this learning.');
    if (m.counterEvidence.length === 0 && m.unresolvedUnknowns.length === 0 && !s(input.contestBasisExplanation)) {
      throw new LearningLifecycleError('CONTEST_BASIS_REQUIRED', 'Give counter-evidence, an unresolved unknown, or explain why neither can be stated yet.');
    }
    assertContentGuards(current, m);
    assertNoSilentDrops(current, m, input);
    return; // CONTEST needs no second learning, no relationship, no proof of falsity (Law 7)
  }
  if (action === 'SUPERSEDE') {
    if (input.confirmSameLearning !== true) throw new LearningLifecycleError('SAME_LEARNING_NOT_CONFIRMED', 'Confirm the replacement belongs to the same underlying learning (otherwise record a separate learning).');
    if (!s(input.learningStatement)) throw new LearningLifecycleError('REPLACEMENT_STATEMENT_REQUIRED', 'Give the replacement learning statement.');
    if (!s(input.replacementSummary)) throw new LearningLifecycleError('REPLACEMENT_EXPLANATION_REQUIRED', 'Explain what changed and why the replacement is appropriate.');
    if (!s(input.retainedValidity)) throw new LearningLifecycleError('RETAINED_VALIDITY_REQUIRED', 'Say what remains valid from the previous version.');
    assertContentGuards(current, m);
    assertNoSilentDrops(current, m, input);
    return;
  }
  if (action === 'RETIRE') return; // reason already required above; content copied unchanged
  throw new LearningLifecycleError('INVALID_ACTION', 'Unknown lifecycle action.');
}

/** Build the new revision's fields from the predecessor + validated input. Lineage COPIED from the predecessor (Law 5);
 *  content merged; lifecycle metadata set. Repo assigns id/logicalLearningId/revision/root/predecessor/createdAt. */
export function buildRevisionFields(action: Exclude<LearningLifecycleAction, 'CREATE'>, pred: StrategicLearningRecord, input: LifecycleTransitionInput):
  Omit<StrategicLearningRecord, 'id' | 'founderId' | 'logicalLearningId' | 'revision' | 'createdAt' | 'rootLearningId' | 'predecessorLearningId'> {
  const m = mergedContent(pred, input);
  return {
    schemaVersion: pred.schemaVersion,
    lifecycleAction: action, lifecycleReason: s(input.lifecycleReason),
    replacementSummary: action === 'SUPERSEDE' ? s(input.replacementSummary) : null,
    retainedValidity: action === 'SUPERSEDE' ? s(input.retainedValidity) : null,
    counterevidenceResolution: s(input.counterevidenceResolution) || null,
    unknownsResolution: s(input.unknownsResolution) || null,
    // origin + lineage copied verbatim from the predecessor — never rebuilt (Laws 5, 12/ADR-017)
    learningOrigin: pred.learningOrigin, outcomeReviewId: pred.outcomeReviewId, learningCandidateId: pred.learningCandidateId,
    reviewRecordId: pred.reviewRecordId, reviewRevision: pred.reviewRevision, planRecordId: pred.planRecordId, commitmentRecordId: pred.commitmentRecordId,
    decisionRecordId: pred.decisionRecordId, recommendationSessionId: pred.recommendationSessionId, provenanceManifestVersion: pred.provenanceManifestVersion,
    learningStatement: m.learningStatement, learningCategory: m.learningCategory, confidence: m.confidence,
    priorUnderstanding: m.priorUnderstanding, revisedUnderstanding: m.revisedUnderstanding, changeStatement: m.changeStatement,
    learningScope: m.learningScope, broadScopeAcknowledged: m.broadScopeAcknowledged, isCausalHypothesis: m.isCausalHypothesis,
    boundaryConditions: m.boundaryConditions, counterEvidence: m.counterEvidence, unresolvedUnknowns: m.unresolvedUnknowns,
    observations: m.observations, evidenceReferences: m.evidenceReferences,
    founderAuthored: true, modelSuggested: false, acceptedByFounder: true,
    idempotencyKey: s(input.idempotencyKey).slice(0, 200),
  };
}
