/**
 * Pg repository for Strategic Plan Review Records (V075). Strictly APPEND-ONLY: each review is an immutable standalone
 * record; no method issues an UPDATE (a BEFORE-UPDATE trigger forbids it). Creating a review performs NO lifecycle
 * mutation. Creation is idempotent on (founder, idempotency_key). Founder-isolated.
 */
import { generateId } from '@bb/shared';
import { buildReviewFields, PLAN_REVIEW_SCHEMA_VERSION, type StrategicPlanReviewRecord, type PlanReviewInput } from './strategic-plan-review';
import type { StrategicPlanRecord } from './strategic-plan';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgStrategicPlanReviewRepository {
  constructor(private readonly db: AnyDB) {}

  /** Create ONE immutable review of an exact plan revision. Idempotent on (founder, idempotency_key). */
  async create(founderId: string, plan: StrategicPlanRecord, input: PlanReviewInput, now: Date): Promise<StrategicPlanReviewRecord> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    const f = buildReviewFields(plan, input);
    const id = generateId();
    const values = {
      id, founder_id: founderId, logical_review_id: id, revision: 1, schema_version: PLAN_REVIEW_SCHEMA_VERSION,
      plan_record_id: f.planRecordId, plan_logical_id: f.planLogicalId, plan_revision: f.planRevision, plan_schema_version: f.planSchemaVersion,
      commitment_record_id: f.commitmentRecordId, commitment_logical_id: f.commitmentLogicalId, commitment_revision: f.commitmentRevision, decision_record_id: f.decisionRecordId,
      recommendation_session_id: f.recommendationSessionId, provenance_manifest_version: f.provenanceManifestVersion, grounding_status_at_planning: f.groundingStatusAtPlanning, alignment_at_planning: f.alignmentAtPlanning,
      review_statement: f.reviewStatement, review_period_start: f.reviewPeriodStart, review_period_end: f.reviewPeriodEnd,
      observations: JSON.stringify(f.observations), evidence_references: JSON.stringify(f.evidenceReferences), assumption_assessments: JSON.stringify(f.assumptionAssessments),
      dependency_assessments: JSON.stringify(f.dependencyAssessments), milestone_assessments: JSON.stringify(f.milestoneAssessments), context_changes: JSON.stringify(f.contextChanges),
      unresolved_unknowns: JSON.stringify(f.unresolvedUnknowns), review_conclusion: f.reviewConclusion, selected_disposition: f.selectedDisposition,
      authorship: JSON.stringify(f.authorship), idempotency_key: f.idempotencyKey, created_at: now.toISOString(),
    };
    try { return this.toDomain(await this.db.insertInto('business.strategic_plan_review_record').values(values).returningAll().executeTakeFirst()); }
    catch (e) { const again = await this.byIdempotencyKey(founderId, input.idempotencyKey); if (again) return again; throw e; }
  }

  /** All reviews for one logical plan (any revision reviewed), newest first. */
  async listByPlan(founderId: string, planLogicalId: string): Promise<StrategicPlanReviewRecord[]> {
    const rows = await this.db.selectFrom('business.strategic_plan_review_record').selectAll().where('founder_id', '=', founderId).where('plan_logical_id', '=', planLogicalId).orderBy('created_at', 'desc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  async getById(founderId: string, reviewId: string): Promise<StrategicPlanReviewRecord | null> {
    const r = await this.db.selectFrom('business.strategic_plan_review_record').selectAll().where('founder_id', '=', founderId).where('id', '=', reviewId).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  private async byIdempotencyKey(founderId: string, key: string): Promise<StrategicPlanReviewRecord | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.strategic_plan_review_record').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  private toDomain(r: AnyDB): StrategicPlanReviewRecord {
    const json = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    return {
      id: r.id, founderId: r.founder_id, logicalReviewId: r.logical_review_id, revision: Number(r.revision),
      planRecordId: r.plan_record_id, planLogicalId: r.plan_logical_id, planRevision: Number(r.plan_revision), planSchemaVersion: r.plan_schema_version,
      commitmentRecordId: r.commitment_record_id, commitmentLogicalId: r.commitment_logical_id, commitmentRevision: Number(r.commitment_revision), decisionRecordId: r.decision_record_id ?? null,
      recommendationSessionId: r.recommendation_session_id ?? null, provenanceManifestVersion: r.provenance_manifest_version ?? null, groundingStatusAtPlanning: r.grounding_status_at_planning ?? null, alignmentAtPlanning: r.alignment_at_planning,
      reviewStatement: r.review_statement ?? null, reviewPeriodStart: iso(r.review_period_start), reviewPeriodEnd: iso(r.review_period_end),
      observations: json(r.observations) ?? [], evidenceReferences: json(r.evidence_references) ?? [], assumptionAssessments: json(r.assumption_assessments) ?? [],
      dependencyAssessments: json(r.dependency_assessments) ?? [], milestoneAssessments: json(r.milestone_assessments) ?? [], contextChanges: json(r.context_changes) ?? [],
      unresolvedUnknowns: json(r.unresolved_unknowns) ?? [], reviewConclusion: r.review_conclusion, selectedDisposition: r.selected_disposition,
      authorship: json(r.authorship) ?? {}, idempotencyKey: r.idempotency_key, createdAt: iso(r.created_at)!,
    };
  }
}
