/**
 * Pg repository for durable Founder Strategy sessions (V066). Mirrors the market-review discipline: idempotent
 * create (partial unique index → duplicate active returns the existing), lease-based claim (FOR UPDATE SKIP
 * LOCKED), terminal-state protection, stale recovery, bounded per-category retry, prior-successful lookup.
 * The generated recommendation is immutable; internal error detail is never returned to founder-safe callers.
 */
import { generateId } from '@bb/shared';
import { assertTransition, sessionRetryable, type StrategicSession, type StrategicSessionStatus, type StrategicJob, type StrategicSubtype, type StrategyFailureCategory, type StrategicRecommendation, type InsufficientStrategicEvidence, type SessionContextConflict, type SessionProvenanceValidation, type SerializedProvenanceManifestView } from './strategy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
const ACTIVE = ['QUEUED', 'PROCESSING'];

export class PgStrategicSessionRepository {
  constructor(private readonly db: AnyDB) {}

  async create(founderId: string, input: { strategicJob: StrategicJob; subtype: StrategicSubtype; questionText: string; modelId: string; promptVersion: string; schemaVersion: string; contextSnapshotId?: string | null }, now: Date, maxAttempts = 3): Promise<StrategicSession> {
    const prior = await this.db.selectFrom('business.strategic_session').select('id').where('founder_id', '=', founderId).where('status', '=', 'READY').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    const nowIso = now.toISOString();
    try {
      const row = await this.db.insertInto('business.strategic_session').values({
        id: generateId(), founder_id: founderId, status: 'QUEUED', strategic_job: input.strategicJob, subtype: input.subtype,
        question_text: input.questionText, model_id: input.modelId, prompt_version: input.promptVersion, schema_version: input.schemaVersion,
        context_snapshot_id: input.contextSnapshotId ?? null,
        attempt_count: 1, max_attempts: maxAttempts, prior_successful_session_id: prior?.id ?? null, created_at: nowIso, updated_at: nowIso,
      }).returningAll().executeTakeFirst();
      return this.toDomain(row);
    } catch {
      const existing = await this.db.selectFrom('business.strategic_session').selectAll().where('founder_id', '=', founderId).where('question_text', '=', input.questionText).where('status', 'in', ACTIVE).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      if (existing) return this.toDomain(existing);
      throw new Error('strategic session create conflict without an active session');
    }
  }

  async getById(founderId: string, id: string): Promise<StrategicSession | null> {
    const r = await this.db.selectFrom('business.strategic_session').selectAll().where('founder_id', '=', founderId).where('id', '=', id).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async listByFounder(founderId: string): Promise<StrategicSession[]> {
    const rows = await this.db.selectFrom('business.strategic_session').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'desc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }

  async claimQueued(now: Date, leaseMs: number): Promise<StrategicSession | null> {
    const nowIso = now.toISOString(); const leaseIso = new Date(now.getTime() + leaseMs).toISOString();
    return this.db.transaction().execute(async (tx: AnyDB) => {
      const row = await tx.selectFrom('business.strategic_session').selectAll().where('status', '=', 'QUEUED').orderBy('created_at', 'asc').limit(1).forUpdate().skipLocked().executeTakeFirst();
      if (!row) return null;
      const claimed = await tx.updateTable('business.strategic_session').set({ status: 'PROCESSING', claimed_at: nowIso, lease_expires_at: leaseIso, started_at: row.started_at ?? nowIso, updated_at: nowIso }).where('id', '=', row.id).returningAll().executeTakeFirst();
      return this.toDomain(claimed);
    });
  }

  /** Record the assembled context snapshot (which understanding version + context health + horizon the reasoning used). */
  async recordAssembly(id: string, snapshot: { understandingVersion: number | null; contextHealth: unknown; decisionHorizon: string | null }, now: Date): Promise<void> {
    await this.db.updateTable('business.strategic_session').set({ understanding_version: snapshot.understandingVersion, context_health: JSON.stringify(snapshot.contextHealth ?? null), decision_horizon: snapshot.decisionHorizon, updated_at: now.toISOString() }).where('id', '=', id).execute();
  }

  async markReady(id: string, recommendation: StrategicRecommendation, now: Date, contextConflicts?: SessionContextConflict[], provenanceValidation?: SessionProvenanceValidation, provenanceManifest?: SerializedProvenanceManifestView, tx?: unknown): Promise<StrategicSession | null> {
    const db = (tx ?? this.db) as AnyDB;
    const r = await db.updateTable('business.strategic_session').set({ status: 'READY', recommendation: JSON.stringify(recommendation), context_conflicts: contextConflicts && contextConflicts.length ? JSON.stringify(contextConflicts) : null, provenance_validation: provenanceValidation ? JSON.stringify(provenanceValidation) : null, provenance_manifest: provenanceManifest ? JSON.stringify(provenanceManifest) : null, finished_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() }).where('id', '=', id).where('status', '=', 'PROCESSING').returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async markInsufficient(id: string, reason: InsufficientStrategicEvidence, safe: string, now: Date, contextConflicts?: SessionContextConflict[], provenanceValidation?: SessionProvenanceValidation, provenanceManifest?: SerializedProvenanceManifestView): Promise<StrategicSession | null> {
    const r = await this.db.updateTable('business.strategic_session').set({ status: 'INSUFFICIENT_EVIDENCE', insufficient_reason: JSON.stringify(reason), context_conflicts: contextConflicts && contextConflicts.length ? JSON.stringify(contextConflicts) : null, provenance_validation: provenanceValidation ? JSON.stringify(provenanceValidation) : null, provenance_manifest: provenanceManifest ? JSON.stringify(provenanceManifest) : null, founder_safe_error: safe, finished_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() }).where('id', '=', id).where('status', '=', 'PROCESSING').returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async markFailed(id: string, category: StrategyFailureCategory, safe: string, detail: string, now: Date): Promise<StrategicSession | null> {
    const r = await this.db.updateTable('business.strategic_session').set({ status: 'FAILED', failure_category: category, founder_safe_error: safe, internal_error_detail: detail.slice(0, 500), finished_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() }).where('id', '=', id).where('status', 'in', ACTIVE).returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async recoverStale(now: Date): Promise<number> {
    const r = await this.db.updateTable('business.strategic_session').set({ status: 'FAILED', failure_category: 'MODEL_FAILED', founder_safe_error: 'Something went wrong. Try again.', internal_error_detail: 'stale lease (worker crash)', finished_at: now.toISOString(), lease_expires_at: null, updated_at: now.toISOString() }).where('status', 'in', ACTIVE).where('lease_expires_at', '<', now.toISOString()).returningAll().execute();
    return Array.isArray(r) ? r.length : 0;
  }
  async retry(founderId: string, id: string, now: Date): Promise<StrategicSession | null> {
    const cur = await this.db.selectFrom('business.strategic_session').select(['attempt_count', 'max_attempts', 'status', 'failure_category']).where('id', '=', id).where('founder_id', '=', founderId).where('status', '=', 'FAILED').executeTakeFirst();
    if (!cur || !sessionRetryable(cur.status as StrategicSessionStatus, cur.failure_category ?? null, Number(cur.attempt_count), Number(cur.max_attempts))) return null;
    const r = await this.db.updateTable('business.strategic_session').set({ status: 'QUEUED', failure_category: null, founder_safe_error: null, internal_error_detail: null, claimed_at: null, lease_expires_at: null, finished_at: null, attempt_count: Number(cur.attempt_count) + 1, updated_at: now.toISOString() }).where('id', '=', id).where('founder_id', '=', founderId).where('status', '=', 'FAILED').returningAll().executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }

  private toDomain(r: AnyDB): StrategicSession {
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    const json = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
    return {
      id: r.id, founderId: r.founder_id, status: r.status, strategicJob: r.strategic_job, subtype: r.subtype,
      questionText: r.question_text, decisionHorizon: r.decision_horizon ?? null, understandingVersion: r.understanding_version == null ? null : Number(r.understanding_version),
      contextHealth: json(r.context_health), recommendation: json(r.recommendation), insufficientReason: json(r.insufficient_reason), contextConflicts: json(r.context_conflicts) ?? null, provenanceValidation: json(r.provenance_validation) ?? null, provenanceManifest: json(r.provenance_manifest) ?? null,
      failureCategory: (r.failure_category as StrategyFailureCategory) ?? null, founderSafeError: r.founder_safe_error ?? null, priorSuccessfulSessionId: r.prior_successful_session_id ?? null,
      modelId: r.model_id ?? null, promptVersion: r.prompt_version ?? null, schemaVersion: r.schema_version ?? null,
      contextSnapshotId: r.context_snapshot_id ?? null,
      attemptCount: Number(r.attempt_count), maxAttempts: Number(r.max_attempts),
      claimedAt: iso(r.claimed_at), leaseExpiresAt: iso(r.lease_expires_at), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
      createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
    };
  }
}
