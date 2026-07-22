/**
 * Pg repository for Strategic Learning Records (V076 + V077 + V078 lifecycle). Strictly APPEND-ONLY: every revision is an
 * immutable row; a BEFORE-UPDATE trigger forbids UPDATE and a BEFORE-DELETE trigger forbids individual DELETE. A lifecycle
 * transition (REFINE/CONTEST/SUPERSEDE/RETIRE) appends a new revision of ONE logical thread under a row lock, with a
 * unique (founder, predecessor) index preventing forks. Founder-isolated. Idempotent on (founder, idempotency_key).
 */
import { generateId } from '@bb/shared';
import { buildLearningFields, buildLearningFieldsFromCandidate, LEARNING_SCHEMA_VERSION, type StrategicLearningRecord, type LearningInput, type CandidateLineage } from './strategic-learning';
import { validateLifecycleTransition, buildRevisionFields, getEffectiveRevision, LearningLifecycleError, type LifecycleTransitionInput } from './strategic-learning-lifecycle';
import type { LearningLifecycleAction } from './strategic-learning';
import type { StrategicPlanReviewRecord } from './strategic-plan-review';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
const jsonb = (v: unknown) => JSON.stringify(v ?? []);
function rowValues(f: Omit<StrategicLearningRecord, 'id' | 'founderId' | 'logicalLearningId' | 'revision' | 'createdAt' | 'rootLearningId'>) {
  return {
    schema_version: LEARNING_SCHEMA_VERSION,
    lifecycle_action: f.lifecycleAction, predecessor_learning_id: f.predecessorLearningId, lifecycle_reason: f.lifecycleReason,
    replacement_summary: f.replacementSummary, retained_validity: f.retainedValidity,
    counterevidence_resolution: f.counterevidenceResolution, unknowns_resolution: f.unknownsResolution,
    learning_origin: f.learningOrigin, outcome_review_id: f.outcomeReviewId, learning_candidate_id: f.learningCandidateId,
    review_record_id: f.reviewRecordId, review_revision: f.reviewRevision, plan_record_id: f.planRecordId, commitment_record_id: f.commitmentRecordId,
    decision_record_id: f.decisionRecordId, recommendation_session_id: f.recommendationSessionId, provenance_manifest_version: f.provenanceManifestVersion,
    learning_statement: f.learningStatement, learning_category: f.learningCategory, confidence: f.confidence,
    prior_understanding: f.priorUnderstanding, revised_understanding: f.revisedUnderstanding, change_statement: f.changeStatement,
    learning_scope: f.learningScope, broad_scope_acknowledged: f.broadScopeAcknowledged, is_causal_hypothesis: f.isCausalHypothesis,
    boundary_conditions: jsonb(f.boundaryConditions), counter_evidence: jsonb(f.counterEvidence), unresolved_unknowns: jsonb(f.unresolvedUnknowns),
    observations: jsonb(f.observations), evidence_references: jsonb(f.evidenceReferences),
    founder_authored: f.founderAuthored, model_suggested: f.modelSuggested, accepted_by_founder: f.acceptedByFounder,
    idempotency_key: f.idempotencyKey,
  };
}

export class PgStrategicLearningRepository {
  constructor(private readonly db: AnyDB) {}

  /** CREATE a new learning thread from an exact review (revision 1, its own root). Idempotent. */
  async create(founderId: string, review: StrategicPlanReviewRecord, input: LearningInput, now: Date): Promise<StrategicLearningRecord> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    const f = buildLearningFields(review, input);
    const id = generateId();
    const values = { id, founder_id: founderId, logical_learning_id: id, revision: 1, root_learning_id: id, created_at: now.toISOString(), ...rowValues(f) };
    try { return this.toDomain(await this.db.insertInto('business.strategic_learning_record').values(values).returningAll().executeTakeFirst()); }
    catch (e) { const again = await this.byIdempotencyKey(founderId, input.idempotencyKey); if (again) return again; throw e; }
  }

  /** CREATE an OUTCOME_REVIEW-origin learning thread from an accepted Learning Candidate (ADR-017). Idempotent. */
  async createFromCandidate(founderId: string, candidate: CandidateLineage, input: LearningInput, now: Date): Promise<StrategicLearningRecord> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    return this.createFromCandidateTx(this.db, founderId, candidate, input, now);
  }
  /** As createFromCandidate, but inside an existing transaction (used by the atomic candidate ACCEPT). */
  async createFromCandidateTx(tx: AnyDB, founderId: string, candidate: CandidateLineage, input: LearningInput, now: Date): Promise<StrategicLearningRecord> {
    const f = buildLearningFieldsFromCandidate(candidate, input);
    const id = generateId();
    const values = { id, founder_id: founderId, logical_learning_id: id, revision: 1, root_learning_id: id, created_at: now.toISOString(), ...rowValues(f) };
    return this.toDomain(await tx.insertInto('business.strategic_learning_record').values(values).returningAll().executeTakeFirst());
  }

  /** Append a lifecycle revision (REFINE/CONTEST/SUPERSEDE/RETIRE) to a thread under a row lock. No-fork, idempotent. */
  async appendRevision(founderId: string, logicalLearningId: string, action: Exclude<LearningLifecycleAction, 'CREATE'>, input: LifecycleTransitionInput, now: Date): Promise<StrategicLearningRecord> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    return this.db.transaction().execute(async (tx: AnyDB) => {
      const rows = await tx.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).where('logical_learning_id', '=', logicalLearningId).forUpdate().execute();
      if (!rows.length) throw new LearningLifecycleError('STALE_PREDECESSOR', 'Learning thread not found.', true);
      const revisions = (rows as AnyDB[]).map((r) => this.toDomain(r));
      const effective = getEffectiveRevision(revisions);
      validateLifecycleTransition(action, effective, input); // authoritative validation under lock
      const f = buildRevisionFields(action, effective, input);
      const id = generateId();
      const values = { id, founder_id: founderId, logical_learning_id: effective.logicalLearningId, revision: effective.revision + 1, root_learning_id: effective.rootLearningId, created_at: now.toISOString(), ...rowValues({ ...f, predecessorLearningId: effective.id }) };
      try {
        return this.toDomain(await tx.insertInto('business.strategic_learning_record').values(values).returningAll().executeTakeFirst());
      } catch (e) {
        // unique (founder, predecessor) violation ⇒ a concurrent transition already consumed this predecessor (Law 23).
        if (String((e as Error).message).match(/uniq_slr_predecessor|uniq_slr_thread_revision|duplicate key/i)) {
          throw new LearningLifecycleError('STALE_PREDECESSOR', 'This learning changed since you loaded it. Reload and try again.', true);
        }
        throw e;
      }
    });
  }

  /** All revisions of one logical thread, ascending. */
  async getThread(founderId: string, logicalLearningId: string): Promise<StrategicLearningRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).where('logical_learning_id', '=', logicalLearningId).orderBy('revision', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  /** Effective (latest) revision per thread for a founder, newest thread first. */
  async listThreads(founderId: string): Promise<StrategicLearningRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).orderBy('logical_learning_id', 'asc').orderBy('revision', 'asc').execute();
    const byThread = new Map<string, StrategicLearningRecord>();
    for (const r of rows as AnyDB[]) { const d = this.toDomain(r); byThread.set(d.logicalLearningId, d); } // last (highest revision) wins
    return [...byThread.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async getRevisionById(founderId: string, revisionId: string): Promise<StrategicLearningRecord | null> {
    const r = await this.db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).where('id', '=', revisionId).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  /** All learnings (every revision) for a founder, newest first. */
  async listByFounder(founderId: string): Promise<StrategicLearningRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'desc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  async getById(founderId: string, logicalLearningId: string): Promise<StrategicLearningRecord | null> {
    const rows = await this.getThread(founderId, logicalLearningId);
    return rows.length ? getEffectiveRevision(rows) : null;
  }
  private async byIdempotencyKey(founderId: string, key: string): Promise<StrategicLearningRecord | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  private toDomain(r: AnyDB): StrategicLearningRecord {
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    const arr = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v || '[]') : []);
    return {
      id: r.id, founderId: r.founder_id, logicalLearningId: r.logical_learning_id, revision: Number(r.revision), schemaVersion: r.schema_version,
      lifecycleAction: r.lifecycle_action, rootLearningId: r.root_learning_id, predecessorLearningId: r.predecessor_learning_id ?? null,
      lifecycleReason: r.lifecycle_reason ?? null, replacementSummary: r.replacement_summary ?? null, retainedValidity: r.retained_validity ?? null,
      counterevidenceResolution: r.counterevidence_resolution ?? null, unknownsResolution: r.unknowns_resolution ?? null,
      learningOrigin: r.learning_origin ?? 'PLAN_REVIEW', outcomeReviewId: r.outcome_review_id ?? null, learningCandidateId: r.learning_candidate_id ?? null,
      reviewRecordId: r.review_record_id ?? null, reviewRevision: r.review_revision == null ? null : Number(r.review_revision), planRecordId: r.plan_record_id, commitmentRecordId: r.commitment_record_id,
      decisionRecordId: r.decision_record_id ?? null, recommendationSessionId: r.recommendation_session_id ?? null, provenanceManifestVersion: r.provenance_manifest_version ?? null,
      learningStatement: r.learning_statement, learningCategory: r.learning_category, confidence: r.confidence,
      priorUnderstanding: r.prior_understanding ?? '', revisedUnderstanding: r.revised_understanding ?? '', changeStatement: r.change_statement ?? '',
      learningScope: r.learning_scope, broadScopeAcknowledged: r.broad_scope_acknowledged === true, isCausalHypothesis: r.is_causal_hypothesis === true,
      boundaryConditions: arr(r.boundary_conditions), counterEvidence: arr(r.counter_evidence), unresolvedUnknowns: arr(r.unresolved_unknowns),
      observations: arr(r.observations), evidenceReferences: arr(r.evidence_references),
      founderAuthored: r.founder_authored === true, modelSuggested: r.model_suggested === true, acceptedByFounder: r.accepted_by_founder === true,
      idempotencyKey: r.idempotency_key, createdAt: iso(r.created_at)!,
    };
  }
}
