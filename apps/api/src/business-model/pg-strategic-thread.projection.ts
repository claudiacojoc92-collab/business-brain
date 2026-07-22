/**
 * Show Me the Loop — Strategy Thread READ PROJECTION (non-canonical). Deterministic, founder-isolated reads over accepted
 * records. No mutation, no persistence, no model call, no inferred links. Assembles the visible strategic thread from a root
 * recommendation session; later recommendations are linked ONLY through actual frozen-snapshot inclusion of a promoted
 * learning from this thread (never by date/correlation). Missing exact links are simply absent (surfaced as unavailable).
 */
import type { StrategyThreadView, ThreadPlan, ThreadOutcomeReview, ThreadCandidate, ThreadLearning, ThreadLaterRecommendation, ThreadPromotion } from './strategy-thread';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
const j = (v: unknown) => (typeof v === 'string' ? JSON.parse(v || 'null') : v);
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const recTitle = (rec: unknown): string => {
  const r = (rec ?? {}) as Record<string, unknown>;
  const inner = (r['recommendation'] ?? {}) as Record<string, unknown>;
  return String(inner['title'] ?? r['title'] ?? 'Recommendation');
};

export class PgStrategyThreadProjection {
  constructor(private readonly db: AnyDB) {}

  /** Build the strategic thread rooted at an owned recommendation session. Returns null if not owned/found. */
  async build(founderId: string, rootSessionId: string): Promise<StrategyThreadView | null> {
    const session = await this.db.selectFrom('business.strategic_session').selectAll().where('founder_id', '=', founderId).where('id', '=', rootSessionId).executeTakeFirst();
    if (!session) return null;

    // Decision from this exact recommendation (effective = latest revision of its logical thread).
    const decisionRows = await this.db.selectFrom('business.strategic_decision_record').selectAll().where('founder_id', '=', founderId).where('recommendation_session_id', '=', rootSessionId).orderBy('revision', 'asc').execute();
    const decisionHead = (decisionRows as AnyDB[]).length ? (decisionRows as AnyDB[])[decisionRows.length - 1] : null;
    const decision = decisionHead ? { id: decisionHead.id, logicalId: decisionHead.logical_decision_id, revision: Number(decisionHead.revision), statement: decisionHead.decision_statement, createdAt: iso(decisionHead.created_at)!, fromRecommendationSessionId: rootSessionId } : null;

    // Commitment from that decision (any revision of the decision thread → effective commitment).
    let commitment = null as StrategyThreadView['commitment'];
    const commitmentLogicalIds: string[] = [];
    if (decisionHead) {
      const cRows = await this.db.selectFrom('business.strategic_commitment_record').selectAll().where('founder_id', '=', founderId).where('decision_logical_id', '=', decisionHead.logical_decision_id).orderBy('revision', 'asc').execute();
      const cHead = (cRows as AnyDB[]).length ? (cRows as AnyDB[])[cRows.length - 1] : null;
      if (cHead) { commitment = { id: cHead.id, logicalId: cHead.logical_commitment_id, revision: Number(cHead.revision), statement: cHead.statement, createdAt: iso(cHead.created_at)!, fromDecisionId: decisionHead.id }; commitmentLogicalIds.push(cHead.logical_commitment_id); }
    }

    // Plan revisions from the commitment (all revisions, oldest→newest).
    const plans: ThreadPlan[] = [];
    const learningsById = new Map<string, ThreadLearning>();
    if (commitmentLogicalIds.length) {
      const planRows = await this.db.selectFrom('business.strategic_plan_record').selectAll().where('founder_id', '=', founderId).where('commitment_logical_id', 'in', commitmentLogicalIds).orderBy('logical_plan_id', 'asc').orderBy('revision', 'asc').execute();
      for (const p of planRows as AnyDB[]) {
        const execRows = await this.db.selectFrom('business.execution_report').selectAll().where('founder_id', '=', founderId).where('plan_id', '=', p.id).orderBy('subject_id', 'asc').orderBy('report_sequence', 'asc').execute();
        // effective execution per subject (highest sequence)
        const execBySubject = new Map<string, AnyDB>();
        for (const e of execRows as AnyDB[]) execBySubject.set(e.subject_id, e);
        const executionReports = [...execBySubject.values()].map((e) => ({ subjectId: e.subject_id, reportedState: e.report_kind === 'WITHDRAW' ? 'NOT_REPORTED' : e.execution_state, statement: e.founder_statement ?? null, reportedAt: iso(e.reported_at) }));

        const reviewRows = await this.db.selectFrom('business.strategic_outcome_review').selectAll().where('founder_id', '=', founderId).where('plan_record_id', '=', p.id).orderBy('review_sequence', 'asc').execute();
        const outcomeReviews: ThreadOutcomeReview[] = [];
        for (const r of reviewRows as AnyDB[]) {
          const candRows = await this.db.selectFrom('business.learning_candidate').selectAll().where('founder_id', '=', founderId).where('outcome_review_id', '=', r.id).orderBy('logical_candidate_id', 'asc').orderBy('revision', 'asc').execute();
          const byThread = new Map<string, AnyDB[]>();
          for (const c of candRows as AnyDB[]) { const arr = byThread.get(c.logical_candidate_id) ?? []; arr.push(c); byThread.set(c.logical_candidate_id, arr); }
          const candidates: ThreadCandidate[] = [];
          for (const [logicalId, revs] of byThread) {
            const head = revs[revs.length - 1]!;
            const decRows = await this.db.selectFrom('business.learning_candidate_decision').selectAll().where('founder_id', '=', founderId).where('logical_candidate_id', '=', logicalId).orderBy('created_at', 'asc').execute();
            const terminal = (decRows as AnyDB[]).find((d) => d.verdict === 'ADOPT' || d.verdict === 'REJECT' || d.verdict === 'WITHDRAW');
            const status = terminal ? (terminal.verdict === 'ADOPT' ? 'ADOPTED' : terminal.verdict === 'REJECT' ? 'REJECTED' : 'WITHDRAWN') : ((decRows as AnyDB[]).some((d) => d.verdict === 'DEFER') ? 'DEFERRED' : 'PROPOSED');
            const learningId = terminal?.verdict === 'ADOPT' ? (terminal.resulting_learning_id ?? null) : null;
            candidates.push({ logicalCandidateId: logicalId, headRevisionId: head.id, revision: Number(head.revision), statement: head.candidate_statement, status: status as ThreadCandidate['status'], unknowns: j(head.unknown_markers) ?? [], contradictions: j(head.contradiction_markers) ?? [], createdAt: iso(head.created_at)!, fromOutcomeReviewId: r.id, learningId });
            if (learningId) {
              const lRows = await this.db.selectFrom('business.strategic_learning_record').selectAll().where('founder_id', '=', founderId).where('logical_learning_id', '=', (await this.logicalOfLearning(founderId, learningId))).orderBy('revision', 'asc').execute();
              const lHead = (lRows as AnyDB[])[(lRows as AnyDB[]).length - 1];
              if (lHead && !learningsById.has(lHead.logical_learning_id)) {
                const revisionIds = (lRows as AnyDB[]).map((x) => x.id);
                const promoRows = await this.db.selectFrom('business.learning_promotion_event').selectAll().where('founder_id', '=', founderId).where('logical_learning_id', '=', lHead.logical_learning_id).orderBy('promotion_sequence', 'asc').execute();
                const promotions: ThreadPromotion[] = (promoRows as AnyDB[]).map((pr) => ({ promotionEventId: pr.id, target: pr.target, action: pr.promotion_action, learningRevisionId: pr.learning_revision_id, at: iso(pr.created_at)! }));
                learningsById.set(lHead.logical_learning_id, { learningId: lHead.id, logicalLearningId: lHead.logical_learning_id, origin: lHead.learning_origin, statement: lHead.learning_statement, scope: lHead.learning_scope, confidence: lHead.confidence, createdAt: iso(lHead.created_at)!, fromCandidateRevisionId: lHead.learning_candidate_id ?? null, fromOutcomeReviewId: lHead.outcome_review_id ?? null, fromPlanReviewId: lHead.review_record_id ?? null, promotions, promoted: promotions.some((x) => x.action !== 'REMOVE'), _revisionIds: revisionIds } as ThreadLearning & { _revisionIds: string[] });
              }
            }
          }
          outcomeReviews.push({ reviewId: r.id, observedOutcome: r.observed_outcome, statement: r.founder_outcome_statement, unknowns: j(r.unknowns) ?? [], createdAt: iso(r.created_at)!, fromPlanRecordId: p.id, contextSnapshotId: r.context_snapshot_id, candidates });
        }
        plans.push({ planId: p.id, logicalPlanId: p.logical_plan_id, revision: Number(p.revision), title: p.title, status: p.lifecycle, createdAt: iso(p.created_at)!, fromCommitmentId: commitment?.id ?? null, executionReports, outcomeReviews });
      }
    }

    const learnings = [...learningsById.values()];
    // Later recommendations: sessions (not root) whose frozen snapshot lists a promoted learning-revision from this thread.
    const usedInLaterRecommendations = await this.laterRecommendations(founderId, rootSessionId, learnings as (ThreadLearning & { _revisionIds?: string[] })[]);
    for (const l of learnings) delete (l as ThreadLearning & { _revisionIds?: string[] })._revisionIds;

    return {
      rootSessionId,
      recommendation: { sessionId: session.id, title: recTitle(j(session.recommendation)), question: session.question_text, status: session.status, createdAt: iso(session.created_at)!, snapshotId: session.context_snapshot_id ?? null, snapshotHash: session.snapshot_content_hash ?? null },
      decision, commitment, plans, learnings,
      usedInLaterRecommendations,
      provenanceAvailable: { decision: !!decision, commitment: !!commitment, plan: plans.length > 0 },
      isProjectionNotCanonical: true,
    };
  }

  private async logicalOfLearning(founderId: string, learningRevisionId: string): Promise<string> {
    const r = await this.db.selectFrom('business.strategic_learning_record').select(['logical_learning_id']).where('founder_id', '=', founderId).where('id', '=', learningRevisionId).executeTakeFirst();
    return r ? r.logical_learning_id : learningRevisionId;
  }

  private async laterRecommendations(founderId: string, rootSessionId: string, learnings: (ThreadLearning & { _revisionIds?: string[] })[]): Promise<ThreadLaterRecommendation[]> {
    const revToLearning = new Map<string, ThreadLearning>();
    for (const l of learnings) for (const rid of l._revisionIds ?? []) revToLearning.set(rid, l);
    if (revToLearning.size === 0) return [];
    const sessions = await this.db.selectFrom('business.strategic_session').selectAll().where('founder_id', '=', founderId).where('id', '!=', rootSessionId).where('context_snapshot_id', 'is not', null).orderBy('created_at', 'asc').execute();
    const out: ThreadLaterRecommendation[] = [];
    for (const s of sessions as AnyDB[]) {
      const snap = await this.db.selectFrom('business.context_snapshot').select(['founder_strategic_context']).where('founder_id', '=', founderId).where('id', '=', s.context_snapshot_id).executeTakeFirst();
      if (!snap) continue;
      const fsc = j(snap.founder_strategic_context) ?? {};
      const promoted = Array.isArray(fsc.promotedLearnings) ? fsc.promotedLearnings : [];
      for (const pl of promoted) {
        const learning = revToLearning.get(String(pl.learningRevisionId));
        if (learning) { out.push({ sessionId: s.id, title: recTitle(j(s.recommendation)), question: s.question_text, createdAt: iso(s.created_at)!, includedLearningId: learning.learningId, includedLogicalLearningId: learning.logicalLearningId, includedLearningStatement: learning.statement, contextSnapshotId: s.context_snapshot_id, disclosure: 'This recommendation was generated with a context snapshot that included this promoted learning.' }); break; }
      }
    }
    return out;
  }
}
