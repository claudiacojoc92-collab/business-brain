/**
 * Pg repository for Execution Reports (V083, ADR-015). Strictly APPEND-ONLY + immutable (BEFORE-UPDATE + BEFORE-DELETE
 * triggers). Records founder TESTIMONY about execution against a plan milestone/plan. Writes to nothing else; performs no
 * external action; verifies nothing. A per-(founder, plan, subject) advisory lock + idempotency make head/no-fork
 * admissibility race-free. Effective state derived from the sequence/predecessor chain. Founder-isolated.
 */
import { sql } from 'kysely';
import { generateId } from '@bb/shared';
import {
  assertExecutionReportAdmissible, buildExecutionReportFields, chainHead, deriveEffectiveExecution, isActivelyReported,
  nextExecutionLineage, ExecutionReportError,
  type ExecutionReport, type ExecutionReportInput, type ReportKind, type ExecutionSubjectType, type EffectiveExecution,
} from './execution-report';
import type { StrategicPlanRecord } from './strategic-plan';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgExecutionReportRepository {
  constructor(private readonly db: AnyDB) {}

  /** Record a REPORT/CORRECT/WITHDRAW for a plan subject. Idempotent + race-free per (founder, plan, subject). For a
   * CORRECT/WITHDRAW, `expectedHeadId` must equal the current chain head under the lock (else STALE_HEAD) — this is what
   * makes concurrent corrections fork-free: exactly one wins, the other sees a moved head. */
  async record(founderId: string, kind: ReportKind, plan: StrategicPlanRecord, input: ExecutionReportInput, now: Date, expectedHeadId?: string): Promise<ExecutionReport> {
    const existing = await this.byIdempotencyKey(founderId, input.idempotencyKey);
    if (existing) return existing;
    return this.db.transaction().execute(async (tx: AnyDB) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${founderId}:${plan.logicalPlanId}:${input.subjectType}:${input.subjectId}`}))`.execute(tx);
      const events = await this.listForPlanTx(tx, founderId, plan.logicalPlanId);
      const active = isActivelyReported(events, input.subjectType, input.subjectId);
      assertExecutionReportAdmissible(active, kind, input);
      if (expectedHeadId !== undefined) {
        const head = chainHead(events, input.subjectType, input.subjectId);
        if (!head || head.id !== expectedHeadId) throw new ExecutionReportError('STALE_HEAD', 'This report was already corrected or withdrawn — refresh and try again.');
      }
      const f = buildExecutionReportFields(plan, kind, input, now);
      const lineage = nextExecutionLineage(events, input.subjectType, input.subjectId);
      const values = {
        id: generateId(), founder_id: founderId, subject_type: f.subjectType, subject_id: f.subjectId,
        plan_logical_id: f.planLogicalId, plan_id: f.planId, plan_revision: f.planRevision,
        report_sequence: lineage.reportSequence, predecessor_report_id: lineage.predecessorReportId,
        report_kind: f.reportKind, execution_state: f.executionState, founder_statement: f.founderStatement,
        occurred_at: f.occurredAt, reported_at: now.toISOString(), evidence_references: JSON.stringify(f.evidenceReferences),
        idempotency_key: f.idempotencyKey, source: f.source, created_at: now.toISOString(),
      };
      try { return this.toDomain(await tx.insertInto('business.execution_report').values(values).returningAll().executeTakeFirst()); }
      catch (e) {
        if (String((e as Error).message).match(/uniq_exr_founder_idempotency|duplicate key/i)) { const again = await this.byIdempotencyKey(founderId, input.idempotencyKey); if (again) return again; }
        throw e;
      }
    });
  }

  async getReportById(founderId: string, reportId: string): Promise<ExecutionReport | null> {
    const r = await this.db.selectFrom('business.execution_report').selectAll().where('founder_id', '=', founderId).where('id', '=', reportId).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async listForPlan(founderId: string, planLogicalId: string): Promise<ExecutionReport[]> {
    const rows = await this.db.selectFrom('business.execution_report').selectAll().where('founder_id', '=', founderId).where('plan_logical_id', '=', planLogicalId).orderBy('report_sequence', 'asc').orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  async listForSubject(founderId: string, planLogicalId: string, subjectType: ExecutionSubjectType, subjectId: string): Promise<ExecutionReport[]> {
    return (await this.listForPlan(founderId, planLogicalId)).filter((e) => e.subjectType === subjectType && e.subjectId === subjectId);
  }
  /** Effective founder-reported state for every subject that has any report on this plan. */
  async getEffectiveForPlan(founderId: string, planLogicalId: string): Promise<EffectiveExecution[]> {
    return deriveEffectiveExecution(await this.listForPlan(founderId, planLogicalId));
  }

  private async listForPlanTx(tx: AnyDB, founderId: string, planLogicalId: string): Promise<ExecutionReport[]> {
    const rows = await tx.selectFrom('business.execution_report').selectAll().where('founder_id', '=', founderId).where('plan_logical_id', '=', planLogicalId).execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  private async byIdempotencyKey(founderId: string, key: string): Promise<ExecutionReport | null> {
    if (!key?.trim()) return null;
    const r = await this.db.selectFrom('business.execution_report').selectAll().where('founder_id', '=', founderId).where('idempotency_key', '=', key).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  private toDomain(r: AnyDB): ExecutionReport {
    const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? []));
    return {
      id: r.id, founderId: r.founder_id, subjectType: r.subject_type, subjectId: r.subject_id,
      planLogicalId: r.plan_logical_id, planId: r.plan_id, planRevision: Number(r.plan_revision),
      reportSequence: Number(r.report_sequence), predecessorReportId: r.predecessor_report_id ?? null,
      reportKind: r.report_kind, executionState: r.execution_state, founderStatement: r.founder_statement,
      occurredAt: r.occurred_at ? new Date(r.occurred_at as string).toISOString() : null,
      reportedAt: new Date(r.reported_at as string).toISOString(), evidenceReferences: parse(r.evidence_references),
      idempotencyKey: r.idempotency_key, source: r.source, createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
}
