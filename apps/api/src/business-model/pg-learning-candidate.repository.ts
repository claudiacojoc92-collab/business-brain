/**
 * Pg repository for Learning Candidates + judgments (V087/V088, ADR-017). APPEND-ONLY + immutable (BEFORE-UPDATE +
 * BEFORE-DELETE triggers). A candidate is a REVISIONED proposal derived from an exact Outcome Review; editing appends a new
 * revision under a lock (no-fork; DB-enforced same-chain adjacency). The founder judgment is a four-way append-only log
 * (ADOPT/REJECT/DEFER/WITHDRAW): exactly one TERMINAL per thread; DEFER repeatable; ADOPT atomically creates ONE Strategic
 * Learning (origin=OUTCOME_REVIEW) from the exact revision and is IDEMPOTENT on (founder, idempotency_key). Never promotes.
 */
import { sql } from 'kysely';
import { generateId } from '@bb/shared';
import {
  assertCandidateAdmissible, assertJudgmentAdmissible, buildCandidateFields, buildCandidateRevisionFields,
  buildLearningInputFromCandidate, deriveCandidateStatus, TERMINAL_VERDICTS,
  LearningCandidateError, type LearningCandidate, type LearningCandidateInput, type LearningCandidateDecision, type CandidateVerdict,
} from './learning-candidate';
import type { StrategicOutcomeReview } from './strategic-outcome-review';
import type { StrategicLearningRecord } from './strategic-learning';
import type { PgStrategicLearningRepository } from './pg-strategic-learning.repository';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgLearningCandidateRepository {
  constructor(private readonly db: AnyDB, private readonly learningRepo: PgStrategicLearningRepository) {}

  /** Propose revision 1 of a candidate from an exact owned Outcome Review. Creates NO learning. Idempotent. */
  async create(founderId: string, sor: StrategicOutcomeReview, input: LearningCandidateInput, now: Date): Promise<LearningCandidate> {
    assertCandidateAdmissible(sor, input);
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    const logicalId = generateId();
    const f = buildCandidateFields(sor, input, logicalId);
    return this.insertCandidate(this.db, founderId, f, now, input.idempotencyKey);
  }

  /** Edit → append revision N+1 to a candidate thread under a row lock (history immutable; no-fork). Creates NO learning. */
  async revise(founderId: string, logicalCandidateId: string, sor: StrategicOutcomeReview, input: LearningCandidateInput, now: Date): Promise<LearningCandidate> {
    assertCandidateAdmissible(sor, input);
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    return this.db.transaction().execute(async (tx: AnyDB) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`lcand:${founderId}:${logicalCandidateId}`}))`.execute(tx);
      const rows = await tx.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('logical_candidate_id', '=', logicalCandidateId).orderBy('revision', 'asc').forUpdate().execute();
      if (!rows.length) throw new LearningCandidateError('CANDIDATE_NOT_FOUND', 'Learning candidate not found.');
      const head = this.toCandidate((rows as AnyDB[])[rows.length - 1]);
      if (head.outcomeReviewId !== sor.id) throw new LearningCandidateError('INVALID_OBSERVATION', 'A candidate revision cannot change its source outcome review.');
      const f = buildCandidateRevisionFields(sor, input, head);
      return this.insertCandidate(tx, founderId, f, now, input.idempotencyKey);
    });
  }

  /**
   * The explicit founder judgment on an EXACT candidate revision. Idempotent on (founder, idempotency_key) → returns the
   * same decision (+ learning). At most one TERMINAL judgment per thread; DEFER is non-terminal. ADOPT atomically creates
   * ONE learning from the exact revision. Never promotes.
   */
  async judge(founderId: string, candidateRevisionId: string, verdict: CandidateVerdict, founderJudgment: string, idempotencyKey: string, now: Date): Promise<{ decision: LearningCandidateDecision; learning: StrategicLearningRecord | null }> {
    const priorSame = await this.decisionByIdempotency(founderId, idempotencyKey);
    if (priorSame) return { decision: priorSame, learning: priorSame.resultingLearningId ? await this.learningRepo.getRevisionById(founderId, priorSame.resultingLearningId) : null };
    const candidate = await this.getRevision(founderId, candidateRevisionId);
    if (!candidate) throw new LearningCandidateError('CANDIDATE_NOT_FOUND', 'Learning candidate revision not found.');
    return this.db.transaction().execute(async (tx: AnyDB) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`lcand:${founderId}:${candidate.logicalCandidateId}`}))`.execute(tx);
      // admission targets the CURRENT head revision — a stale (non-head) revision cannot be adopted.
      const rows = await tx.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('logical_candidate_id', '=', candidate.logicalCandidateId).orderBy('revision', 'asc').execute();
      const head = this.toCandidate((rows as AnyDB[])[rows.length - 1]);
      if (head.id !== candidate.id) throw new LearningCandidateError('STALE_CANDIDATE_REVISION', 'A newer revision of this candidate exists — judge the latest revision.');
      const decisions = await this.decisionsForThreadTx(tx, founderId, candidate.logicalCandidateId);
      const terminal = decisions.find((d) => TERMINAL_VERDICTS.has(d.verdict)) ?? null;
      assertJudgmentAdmissible(terminal, verdict, founderJudgment, idempotencyKey);
      let learning: StrategicLearningRecord | null = null;
      if (verdict === 'ADOPT') {
        learning = await this.learningRepo.createFromCandidateTx(tx, founderId, candidate, buildLearningInputFromCandidate(candidate, `adopt:${idempotencyKey}`), now);
      }
      const values = {
        id: generateId(), founder_id: founderId, logical_candidate_id: candidate.logicalCandidateId, candidate_id: candidate.id, candidate_revision_id: candidate.id,
        verdict, founder_judgment: founderJudgment.trim().slice(0, 4000), resulting_learning_id: learning?.id ?? null, idempotency_key: idempotencyKey.trim().slice(0, 200), created_at: now.toISOString(),
      };
      try {
        const decision = this.toDecision(await tx.insertInto('business.learning_candidate_decision').values(values).returningAll().executeTakeFirst());
        return { decision, learning };
      } catch (e) {
        if (String((e as Error).message).match(/uniq_lcdec_terminal|uniq_lcdec_founder_idempotency|duplicate key/i)) {
          throw new LearningCandidateError('CANDIDATE_ALREADY_DECIDED', 'This candidate was just decided — reload and try again.');
        }
        throw e;
      }
    });
  }

  async getRevision(founderId: string, candidateRevisionId: string): Promise<LearningCandidate | null> {
    const r = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('id', '=', candidateRevisionId).executeTakeFirst();
    return r ? this.toCandidate(r) : null;
  }
  async getThread(founderId: string, logicalCandidateId: string): Promise<LearningCandidate[]> {
    const rows = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('logical_candidate_id', '=', logicalCandidateId).orderBy('revision', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toCandidate(r));
  }
  async getEffectiveRevision(founderId: string, logicalCandidateId: string): Promise<LearningCandidate | null> {
    const rows = await this.getThread(founderId, logicalCandidateId);
    return rows.length ? rows[rows.length - 1]! : null;
  }
  /** Effective (latest) revision per candidate thread for one Outcome Review. */
  async listForOutcomeReview(founderId: string, outcomeReviewId: string): Promise<LearningCandidate[]> {
    const rows = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('outcome_review_id', '=', outcomeReviewId).orderBy('logical_candidate_id', 'asc').orderBy('revision', 'asc').execute();
    const byThread = new Map<string, LearningCandidate>();
    for (const r of rows as AnyDB[]) { const c = this.toCandidate(r); byThread.set(c.logicalCandidateId, c); } // last (highest revision) wins
    return [...byThread.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  async listByFounder(founderId: string): Promise<LearningCandidate[]> {
    const rows = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toCandidate(r));
  }
  async decisionsForThread(founderId: string, logicalCandidateId: string): Promise<LearningCandidateDecision[]> {
    return this.decisionsForThreadTx(this.db, founderId, logicalCandidateId);
  }
  async statusOf(founderId: string, logicalCandidateId: string): Promise<string> {
    return deriveCandidateStatus(await this.decisionsForThread(founderId, logicalCandidateId));
  }
  async listDecisionsByFounder(founderId: string): Promise<LearningCandidateDecision[]> {
    const rows = await this.db.selectFrom('business.learning_candidate_decision').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDecision(r));
  }

  private async insertCandidate(tx: AnyDB, founderId: string, f: Omit<LearningCandidate, 'id' | 'founderId' | 'createdAt' | 'idempotencyKey'>, now: Date, idempotencyKey: string): Promise<LearningCandidate> {
    const values = {
      id: generateId(), founder_id: founderId, logical_candidate_id: f.logicalCandidateId, revision: f.revision, predecessor_candidate_id: f.predecessorCandidateId,
      outcome_review_id: f.outcomeReviewId, outcome_review_content_hash: f.outcomeReviewContentHash, source_outcome_review_revision: f.sourceOutcomeReviewRevision, source_snapshot_id: f.sourceSnapshotId,
      plan_record_id: f.planRecordId, plan_logical_id: f.planLogicalId, plan_revision: f.planRevision, commitment_record_id: f.commitmentRecordId,
      source_observed_outcome: f.sourceObservedOutcome, candidate_statement: f.candidateStatement, founder_statement: f.founderStatement, candidate_rationale: f.candidateRationale,
      prior_understanding: f.priorUnderstanding, revised_understanding: f.revisedUnderstanding, change_statement: f.changeStatement,
      learning_category: f.learningCategory, applicability_scope: f.applicabilityScope, epistemic_status: f.epistemicStatus,
      is_causal_hypothesis: f.isCausalHypothesis, broad_scope_acknowledged: f.broadScopeAcknowledged,
      selected_observations: JSON.stringify(f.selectedObservations), unknown_markers: JSON.stringify(f.unknownMarkers), contradiction_markers: JSON.stringify(f.contradictionMarkers),
      content_hash: f.contentHash, schema_version: f.schemaVersion, idempotency_key: idempotencyKey.trim().slice(0, 200), created_at: now.toISOString(),
    };
    try { return this.toCandidate(await tx.insertInto('business.learning_candidate').values(values).returningAll().executeTakeFirst()); }
    catch (e) {
      if (String((e as Error).message).match(/uniq_lcand_predecessor|uniq_lcand_thread_revision|fk_lcand_predecessor_same_chain/i)) throw new LearningCandidateError('STALE_CANDIDATE_REVISION', 'This candidate changed since you loaded it — reload and try again.');
      const again = await this.byIdempotencyKey(founderId, idempotencyKey); if (again) return again; throw e;
    }
  }
  private async decisionsForThreadTx(tx: AnyDB, founderId: string, logicalCandidateId: string): Promise<LearningCandidateDecision[]> {
    const rows = await tx.selectFrom('business.learning_candidate_decision').selectAll().where('founder_id', '=', founderId).where('logical_candidate_id', '=', logicalCandidateId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDecision(r));
  }
  private async byIdempotencyKey(founderId: string, key: string): Promise<LearningCandidate | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    return r ? this.toCandidate(r) : null;
  }
  private async decisionByIdempotency(founderId: string, key: string): Promise<LearningCandidateDecision | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.learning_candidate_decision').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    return r ? this.toDecision(r) : null;
  }

  private toCandidate(r: AnyDB): LearningCandidate {
    const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? []));
    return {
      id: r.id, founderId: r.founder_id, logicalCandidateId: r.logical_candidate_id, revision: Number(r.revision), predecessorCandidateId: r.predecessor_candidate_id ?? null,
      outcomeReviewId: r.outcome_review_id, sourceOutcomeReviewRevision: Number(r.source_outcome_review_revision), sourceSnapshotId: r.source_snapshot_id, outcomeReviewContentHash: r.outcome_review_content_hash,
      planRecordId: r.plan_record_id, planLogicalId: r.plan_logical_id, planRevision: Number(r.plan_revision), commitmentRecordId: r.commitment_record_id,
      sourceObservedOutcome: r.source_observed_outcome, candidateStatement: r.candidate_statement, founderStatement: r.founder_statement, candidateRationale: r.candidate_rationale ?? null,
      priorUnderstanding: r.prior_understanding ?? '', revisedUnderstanding: r.revised_understanding ?? '', changeStatement: r.change_statement ?? '',
      learningCategory: r.learning_category, applicabilityScope: r.applicability_scope, epistemicStatus: r.epistemic_status,
      isCausalHypothesis: r.is_causal_hypothesis === true, broadScopeAcknowledged: r.broad_scope_acknowledged === true,
      selectedObservations: parse(r.selected_observations), unknownMarkers: parse(r.unknown_markers), contradictionMarkers: parse(r.contradiction_markers),
      schemaVersion: r.schema_version, contentHash: r.content_hash, idempotencyKey: r.idempotency_key, createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
  private toDecision(r: AnyDB): LearningCandidateDecision {
    return {
      id: r.id, founderId: r.founder_id, logicalCandidateId: r.logical_candidate_id, candidateRevisionId: r.candidate_revision_id ?? r.candidate_id,
      verdict: r.verdict, founderJudgment: r.founder_judgment, resultingLearningId: r.resulting_learning_id ?? null, idempotencyKey: r.idempotency_key, createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
}
