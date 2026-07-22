/**
 * Pg repository for Learning Candidates + their decisions (V087, ADR-017). APPEND-ONLY + immutable (BEFORE-UPDATE +
 * BEFORE-DELETE triggers). A candidate is a proposal derived from an exact Outcome Review; creating it produces NO learning.
 * The founder judgment is explicit and exactly-once (no-fork): ACCEPT atomically creates a Strategic Learning
 * (origin=OUTCOME_REVIEW) + records the decision; DISMISS records the decision and creates nothing. Never promotes.
 */
import { sql } from 'kysely';
import { generateId } from '@bb/shared';
import {
  assertCandidateAdmissible, assertDecisionAdmissible, buildCandidateFields,
  LearningCandidateError, type LearningCandidate, type LearningCandidateInput, type LearningCandidateDecision, type CandidateVerdict,
} from './learning-candidate';
import type { StrategicOutcomeReview } from './strategic-outcome-review';
import type { LearningInput, StrategicLearningRecord } from './strategic-learning';
import type { PgStrategicLearningRepository } from './pg-strategic-learning.repository';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgLearningCandidateRepository {
  constructor(private readonly db: AnyDB, private readonly learningRepo: PgStrategicLearningRepository) {}

  /** Propose a candidate from an exact owned Outcome Review. Creates NO learning. Idempotent. */
  async create(founderId: string, outcomeReview: StrategicOutcomeReview, input: LearningCandidateInput, now: Date): Promise<LearningCandidate> {
    assertCandidateAdmissible(outcomeReview, input);
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    const f = buildCandidateFields(outcomeReview, input);
    const values = {
      id: generateId(), founder_id: founderId, outcome_review_id: f.outcomeReviewId, outcome_review_content_hash: f.outcomeReviewContentHash,
      plan_record_id: f.planRecordId, plan_logical_id: f.planLogicalId, plan_revision: f.planRevision, commitment_record_id: f.commitmentRecordId,
      source_observed_outcome: f.sourceObservedOutcome, candidate_statement: f.candidateStatement, candidate_rationale: f.candidateRationale,
      schema_version: f.schemaVersion, idempotency_key: f.idempotencyKey, created_at: now.toISOString(),
    };
    try { return this.toCandidate(await this.db.insertInto('business.learning_candidate').values(values).returningAll().executeTakeFirst()); }
    catch (e) { const again = await this.byIdempotencyKey(founderId, input.idempotencyKey); if (again) return again; throw e; }
  }

  /**
   * Record the explicit founder judgment on a candidate (exactly once). ACCEPT atomically creates a Strategic Learning
   * (origin=OUTCOME_REVIEW) via the learning repo AND records the decision with resulting_learning_id; DISMISS just records
   * the decision. Under an advisory lock on the candidate; a second decision is rejected (no-fork). Never promotes.
   */
  async decide(founderId: string, candidate: LearningCandidate, verdict: CandidateVerdict, founderJudgment: string, learningInput: LearningInput | null, idempotencyKey: string, now: Date): Promise<{ decision: LearningCandidateDecision; learning: StrategicLearningRecord | null }> {
    return this.db.transaction().execute(async (tx: AnyDB) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`lcand:${founderId}:${candidate.id}`}))`.execute(tx);
      const prior = await this.getDecisionTx(tx, founderId, candidate.id);
      assertDecisionAdmissible(prior, verdict, founderJudgment, idempotencyKey);
      let learning: StrategicLearningRecord | null = null;
      if (verdict === 'ACCEPT') {
        if (!learningInput) throw new LearningCandidateError('JUDGMENT_REQUIRED', 'Accepting a candidate requires the learning details.');
        learning = await this.learningRepo.createFromCandidateTx(tx, founderId, candidate, learningInput, now);
      }
      const values = {
        id: generateId(), founder_id: founderId, candidate_id: candidate.id, verdict, founder_judgment: founderJudgment.trim().slice(0, 4000),
        resulting_learning_id: learning?.id ?? null, idempotency_key: idempotencyKey.trim().slice(0, 200), created_at: now.toISOString(),
      };
      try {
        const decision = this.toDecision(await tx.insertInto('business.learning_candidate_decision').values(values).returningAll().executeTakeFirst());
        return { decision, learning };
      } catch (e) {
        if (String((e as Error).message).match(/uniq_lcdec_candidate|uniq_lcdec_founder_idempotency|duplicate key/i)) {
          throw new LearningCandidateError('CANDIDATE_ALREADY_DECIDED', 'This candidate was just decided — reload and try again.');
        }
        throw e;
      }
    });
  }

  async getById(founderId: string, candidateId: string): Promise<LearningCandidate | null> {
    const r = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('id', '=', candidateId).executeTakeFirst();
    return r ? this.toCandidate(r) : null;
  }
  async listForOutcomeReview(founderId: string, outcomeReviewId: string): Promise<LearningCandidate[]> {
    const rows = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('outcome_review_id', '=', outcomeReviewId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toCandidate(r));
  }
  async listByFounder(founderId: string): Promise<LearningCandidate[]> {
    const rows = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toCandidate(r));
  }
  async getDecision(founderId: string, candidateId: string): Promise<LearningCandidateDecision | null> {
    return this.getDecisionTx(this.db, founderId, candidateId);
  }

  private async getDecisionTx(tx: AnyDB, founderId: string, candidateId: string): Promise<LearningCandidateDecision | null> {
    const r = await tx.selectFrom('business.learning_candidate_decision').selectAll().where('founder_id', '=', founderId).where('candidate_id', '=', candidateId).executeTakeFirst();
    return r ? this.toDecision(r) : null;
  }
  private async byIdempotencyKey(founderId: string, key: string): Promise<LearningCandidate | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    return r ? this.toCandidate(r) : null;
  }

  private toCandidate(r: AnyDB): LearningCandidate {
    return {
      id: r.id, founderId: r.founder_id, outcomeReviewId: r.outcome_review_id, outcomeReviewContentHash: r.outcome_review_content_hash,
      planRecordId: r.plan_record_id, planLogicalId: r.plan_logical_id, planRevision: Number(r.plan_revision), commitmentRecordId: r.commitment_record_id,
      sourceObservedOutcome: r.source_observed_outcome, candidateStatement: r.candidate_statement, candidateRationale: r.candidate_rationale ?? null,
      schemaVersion: r.schema_version, idempotencyKey: r.idempotency_key, createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
  private toDecision(r: AnyDB): LearningCandidateDecision {
    return {
      id: r.id, founderId: r.founder_id, candidateId: r.candidate_id, verdict: r.verdict, founderJudgment: r.founder_judgment,
      resultingLearningId: r.resulting_learning_id ?? null, idempotencyKey: r.idempotency_key, createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
}
