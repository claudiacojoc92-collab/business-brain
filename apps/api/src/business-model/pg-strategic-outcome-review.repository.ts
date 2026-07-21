/**
 * Pg repository for Strategic Outcome Reviews (V086, ADR-016). APPEND-ONLY + immutable (BEFORE-UPDATE + BEFORE-DELETE
 * triggers). Freezes the deterministic assessment of one EXACT Plan revision + its effective execution + the exact Context
 * Snapshot, computes a SHA-256 content hash, and stores it forever. Idempotent + race-free per (founder, plan revision).
 * Founder-isolated. Creates nothing else; performs no external action; verifies/scores nothing.
 */
import { sql } from 'kysely';
import { generateId } from '@bb/shared';
import {
  assertOutcomeReviewAdmissible, composeOutcomeReviewAssessment, computeReviewContentHash, reviewPromptTemplateHash,
  REVIEW_ASSESSMENT_METHOD, REVIEW_COMPOSITION_TEMPLATE_VERSION, STRATEGIC_OUTCOME_REVIEW_SCHEMA_VERSION,
  type StrategicOutcomeReview, type StrategicOutcomeReviewInput, type OutcomeReviewAssessment,
} from './strategic-outcome-review';
import type { StrategicPlanRecord } from './strategic-plan';
import type { EffectiveExecution } from './execution-report';
import type { ContextSnapshot } from './context-snapshot';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgStrategicOutcomeReviewRepository {
  constructor(private readonly db: AnyDB) {}

  /** Freeze + hash + store an immutable outcome review. Idempotent (founder, idempotencyKey); race-free per (founder, plan
   * revision) under an advisory lock — the review_sequence is assigned atomically so concurrent reviews never collide. */
  async create(founderId: string, plan: StrategicPlanRecord, executionEffective: EffectiveExecution[], snapshot: ContextSnapshot, input: StrategicOutcomeReviewInput, now: Date): Promise<StrategicOutcomeReview> {
    assertOutcomeReviewAdmissible(input);
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    const assessment = composeOutcomeReviewAssessment(plan, executionEffective, snapshot, input);
    const contentHash = computeReviewContentHash(assessment);
    return this.db.transaction().execute(async (tx: AnyDB) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`sor:${founderId}:${plan.id}`}))`.execute(tx);
      const seqRow = await tx.selectFrom('business.strategic_outcome_review').select(sql`coalesce(max(review_sequence), 0)`.as('m')).where('founder_id', '=', founderId).where('plan_record_id', '=', plan.id).executeTakeFirst();
      const reviewSequence = Number((seqRow as { m: number } | undefined)?.m ?? 0) + 1;
      const values = {
        id: generateId(), founder_id: founderId,
        plan_record_id: plan.id, plan_logical_id: plan.logicalPlanId, plan_revision: plan.revision, plan_schema_version: 'strategic-plan-1',
        commitment_record_id: plan.commitmentRecordId, commitment_logical_id: plan.commitmentLogicalId,
        context_snapshot_id: snapshot.id, context_snapshot_hash: snapshot.contentHash,
        review_sequence: reviewSequence, assessment: JSON.stringify(assessment),
        observed_outcome: input.observedOutcome, founder_outcome_statement: assessment.founderOutcomeStatement, unknowns: JSON.stringify(assessment.unknowns),
        assessment_method: REVIEW_ASSESSMENT_METHOD, prompt_template_hash: reviewPromptTemplateHash(), model_configuration: JSON.stringify({}),
        review_schema_version: STRATEGIC_OUTCOME_REVIEW_SCHEMA_VERSION, content_hash: contentHash,
        idempotency_key: input.idempotencyKey, created_at: now.toISOString(),
      };
      try { return this.toDomain(await tx.insertInto('business.strategic_outcome_review').values(values).returningAll().executeTakeFirst()); }
      catch (e) {
        if (String((e as Error).message).match(/uniq_sor_founder_idempotency/i)) { const again = await this.byIdempotencyKey(founderId, input.idempotencyKey); if (again) return again; }
        throw e;
      }
    });
  }

  async getById(founderId: string, reviewId: string): Promise<StrategicOutcomeReview | null> {
    const r = await this.db.selectFrom('business.strategic_outcome_review').selectAll().where('founder_id', '=', founderId).where('id', '=', reviewId).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  /** Every review for one EXACT plan revision, in sequence order (append-only history; each stands forever). */
  async listForRevision(founderId: string, planId: string): Promise<StrategicOutcomeReview[]> {
    const rows = await this.db.selectFrom('business.strategic_outcome_review').selectAll().where('founder_id', '=', founderId).where('plan_record_id', '=', planId).orderBy('review_sequence', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  async listByFounder(founderId: string): Promise<StrategicOutcomeReview[]> {
    const rows = await this.db.selectFrom('business.strategic_outcome_review').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  private async byIdempotencyKey(founderId: string, key: string): Promise<StrategicOutcomeReview | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.strategic_outcome_review').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  private toDomain(r: AnyDB): StrategicOutcomeReview {
    const parse = (v: unknown, d: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? d));
    return {
      id: r.id, founderId: r.founder_id,
      planRecordId: r.plan_record_id, planLogicalId: r.plan_logical_id, planRevision: Number(r.plan_revision), planSchemaVersion: r.plan_schema_version,
      commitmentRecordId: r.commitment_record_id, commitmentLogicalId: r.commitment_logical_id,
      contextSnapshotId: r.context_snapshot_id, contextSnapshotHash: r.context_snapshot_hash,
      reviewSequence: Number(r.review_sequence),
      assessment: parse(r.assessment, {}) as OutcomeReviewAssessment,
      observedOutcome: r.observed_outcome, founderOutcomeStatement: r.founder_outcome_statement, unknowns: parse(r.unknowns, []) as string[],
      assessmentMethod: r.assessment_method, promptTemplateHash: r.prompt_template_hash, modelConfiguration: parse(r.model_configuration, {}) as Record<string, unknown>,
      reviewSchemaVersion: r.review_schema_version, contentHash: r.content_hash,
      idempotencyKey: r.idempotency_key, createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
}
// (REVIEW_COMPOSITION_TEMPLATE_VERSION re-exported for tooling/tests that assert the frozen template identity.)
export { REVIEW_COMPOSITION_TEMPLATE_VERSION };
