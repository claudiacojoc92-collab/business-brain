/**
 * Pg repository for Strategic Learning Records (V076 + V077). Strictly APPEND-ONLY: each learning is an immutable
 * standalone record; no method issues an UPDATE (a BEFORE-UPDATE trigger forbids it). Keeping a learning mutates NOTHING
 * else. Creation is idempotent on (founder, idempotency_key). Founder-isolated.
 */
import { generateId } from '@bb/shared';
import { buildLearningFields, LEARNING_SCHEMA_VERSION, type StrategicLearningRecord, type LearningInput } from './strategic-learning';
import type { StrategicPlanReviewRecord } from './strategic-plan-review';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
const jsonb = (v: unknown) => JSON.stringify(v ?? []);

export class PgStrategicLearningRepository {
  constructor(private readonly db: AnyDB) {}

  /** Keep ONE immutable learning from an exact review. Idempotent on (founder, idempotency_key). */
  async create(founderId: string, review: StrategicPlanReviewRecord, input: LearningInput, now: Date): Promise<StrategicLearningRecord> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    const f = buildLearningFields(review, input);
    const id = generateId();
    const values = {
      id, founder_id: founderId, logical_learning_id: id, revision: 1, schema_version: LEARNING_SCHEMA_VERSION,
      review_record_id: f.reviewRecordId, review_revision: f.reviewRevision, plan_record_id: f.planRecordId, commitment_record_id: f.commitmentRecordId,
      decision_record_id: f.decisionRecordId, recommendation_session_id: f.recommendationSessionId, provenance_manifest_version: f.provenanceManifestVersion,
      learning_statement: f.learningStatement, learning_category: f.learningCategory, confidence: f.confidence,
      prior_understanding: f.priorUnderstanding, revised_understanding: f.revisedUnderstanding, change_statement: f.changeStatement,
      learning_scope: f.learningScope, broad_scope_acknowledged: f.broadScopeAcknowledged, is_causal_hypothesis: f.isCausalHypothesis,
      boundary_conditions: jsonb(f.boundaryConditions), counter_evidence: jsonb(f.counterEvidence), unresolved_unknowns: jsonb(f.unresolvedUnknowns),
      observations: jsonb(f.observations), evidence_references: jsonb(f.evidenceReferences),
      founder_authored: f.founderAuthored, model_suggested: f.modelSuggested, accepted_by_founder: f.acceptedByFounder,
      idempotency_key: f.idempotencyKey, created_at: now.toISOString(),
    };
    try { return this.toDomain(await this.db.insertInto('business.strategic_learning_record').values(values).returningAll().executeTakeFirst()); }
    catch (e) { const again = await this.byIdempotencyKey(founderId, input.idempotencyKey); if (again) return again; throw e; }
  }

  /** All learnings for a founder, newest first. */
  async listByFounder(founderId: string): Promise<StrategicLearningRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'desc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  async getById(founderId: string, logicalLearningId: string): Promise<StrategicLearningRecord | null> {
    const r = await this.db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).where('logical_learning_id', '=', logicalLearningId).executeTakeFirst();
    return r ? this.toDomain(r) : null;
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
      reviewRecordId: r.review_record_id, reviewRevision: Number(r.review_revision), planRecordId: r.plan_record_id, commitmentRecordId: r.commitment_record_id,
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
