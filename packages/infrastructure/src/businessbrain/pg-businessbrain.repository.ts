/**
 * Business Brain V1 — Kysely persistence (lifecycle-oriented transactions).
 *
 * Implements BusinessBrainRepository against schema `businessbrain` (V060).
 * Each coarse method is one database transaction mapping to a frozen transaction.
 * Per-Founder lifecycle exclusivity uses SELECT ... FOR UPDATE on the Founder's
 * bb_refresh_status row (the lock anchor). Audit events reuse content-free
 * audit.audit_log, written inside the owning transaction.
 *
 * TYPED_ANY: DB schema type is Kysely<any> per the repo convention (see client.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { generateId } from '@bb/shared';
import { buildTraceability } from '@bb/application';
import type {
  BusinessBrainRepository,
  CommitDiagnosisInput,
  CommitEvidenceInput,
  DevConnectionStatus,
  DiagnosisContent,
  EvidenceVersion,
  ImportRecordInput,
  ObservationInput,
  FailureCategory,
  PublicCurrentVersion,
  PublicRefreshSnapshot,
  StartRefreshInput,
  StartRefreshResult,
} from '@bb/application';
import type { KyselyDB } from '../database/client';

const NONE_SNAPSHOT: PublicRefreshSnapshot = {
  refreshState: 'none',
  importState: 'none',
  diagnosisState: 'none',
  validationState: 'none',
  transitionMarker: 0,
};

export class PgBusinessBrainRepository implements BusinessBrainRepository {
  /** Test seams: force a failure INSIDE the owning transaction to prove rollback. */
  public failNextPromotion = false;
  public failNextAudit = false;

  constructor(private readonly db: KyselyDB) {}

  /** Content-free audit written inside the owning transaction (reuses audit.audit_log). */
  private async audit(
    trx: any,
    founderId: string,
    eventType: string,
    versionId: string,
    at: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (this.failNextAudit) {
      this.failNextAudit = false;
      throw new Error('forced_audit_failure'); // must abort the whole transition
    }
    await trx
      .insertInto('audit.audit_log')
      .values({
        id: generateId(),
        actor_id: founderId,
        actor_role: 'founder',
        event_type: `businessbrain.${eventType}`,
        resource_type: 'bb_version',
        resource_id: versionId,
        success: true,
        metadata,
        created_at: at,
      })
      .execute();
  }

  // ---- Reads ----

  async getRefreshProgress(founderId: string): Promise<PublicRefreshSnapshot> {
    const r = await (this.db as any)
      .selectFrom('businessbrain.bb_refresh_status')
      .selectAll()
      .where('founder_id', '=', founderId)
      .executeTakeFirst();
    if (!r) return NONE_SNAPSHOT;
    return snapshotOf(r);
  }

  async getActiveCandidateVersionId(founderId: string): Promise<string | null> {
    const row = await (this.db as any)
      .selectFrom('businessbrain.bb_version')
      .select('version_id')
      .where('founder_id', '=', founderId)
      .where('lifecycle_status', '=', 'candidate')
      .executeTakeFirst();
    return row?.version_id ?? null;
  }

  async getCurrentAggregate(founderId: string): Promise<PublicCurrentVersion | null> {
    const db = this.db as any;
    const version = await db
      .selectFrom('businessbrain.bb_version')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('lifecycle_status', '=', 'current')
      .executeTakeFirst();
    if (!version) return null;
    const vid = version.version_id;

    const dv = await db
      .selectFrom('businessbrain.bb_diagnosis_version')
      .selectAll()
      .where('version_id', '=', vid)
      .executeTakeFirstOrThrow();

    const consequences = await db
      .selectFrom('businessbrain.bb_business_consequence')
      .select('statement')
      .where('version_id', '=', vid)
      .orderBy('ordinal')
      .execute();
    const rootCauses = await db
      .selectFrom('businessbrain.bb_root_cause')
      .select(['root_cause_id', 'statement']) // id selected for traceability only; output maps to statement below
      .where('version_id', '=', vid)
      .orderBy('ordinal')
      .execute();
    const recommendations = await db
      .selectFrom('businessbrain.bb_recommendation')
      .select(['recommendation_id', 'statement'])
      .where('version_id', '=', vid)
      .orderBy('ordinal')
      .execute();

    // Evidence Section: claims (ordered) each with its measures (ordered).
    const claimRows = await db
      .selectFrom('businessbrain.bb_evidence_claim')
      .selectAll()
      .where('version_id', '=', vid)
      .orderBy('ordinal')
      .execute();
    const claims = [];
    // ADDITIVE (Slice 1): evidence traceability rows, one per public measure, in the same order.
    const evidenceTrace: { evidenceItemId: string; claimIndex: number; measureIndex: number }[] = [];
    for (let claimIndex = 0; claimIndex < claimRows.length; claimIndex += 1) {
      const c = claimRows[claimIndex];
      const measureRows = await db
        .selectFrom('businessbrain.bb_evidence_claim_measure as m')
        .innerJoin('businessbrain.bb_evidence_item as i', 'i.evidence_item_id', 'm.evidence_item_id')
        .select(['i.evidence_item_id as evidence_item_id', 'i.claim_label as descriptor', 'i.kind as kind', 'i.measure_value as value'])
        .where('m.evidence_claim_id', '=', c.evidence_claim_id)
        .orderBy('m.ordinal')
        .execute();
      claims.push({
        claimStatement: c.claim_statement,
        measures: measureRows.map((mr: any) => ({
          descriptor: mr.descriptor,
          kind: mr.kind,
          ...(mr.value === null || mr.value === undefined ? {} : { value: Number(mr.value) }),
        })),
      });
      measureRows.forEach((mr: any, measureIndex: number) =>
        evidenceTrace.push({ evidenceItemId: mr.evidence_item_id, claimIndex, measureIndex }),
      );
    }

    // Execution Plan: actions grouped into phases (by phase_ordinal/label).
    const actionRows = await db
      .selectFrom('businessbrain.bb_execution_plan_action')
      .selectAll()
      .where('version_id', '=', vid)
      .orderBy('phase_ordinal')
      .orderBy('sequence')
      .execute();
    const phases: { label: string; actions: { statement: string; sequence: number }[] }[] = [];
    // ADDITIVE (Slice 1): action traceability rows, aligned to the phases/actions built above.
    const actionTrace: { actionId: string; phaseIndex: number; actionIndex: number }[] = [];
    for (const a of actionRows) {
      let phaseIndex = phases.findIndex((p) => p.label === a.phase_label);
      if (phaseIndex === -1) {
        phases.push({ label: a.phase_label, actions: [] });
        phaseIndex = phases.length - 1;
      }
      const phase = phases[phaseIndex]!;
      const actionIndex = phase.actions.length;
      phase.actions.push({ statement: a.statement, sequence: a.sequence });
      actionTrace.push({ actionId: a.action_id, phaseIndex, actionIndex });
    }

    // Phase ②: the imported window (surfaced with the Evidence Section).
    const imp = await db
      .selectFrom('businessbrain.bb_import')
      .select(['window_from', 'window_to', 'imported_post_count'])
      .where('version_id', '=', vid)
      .executeTakeFirst();

    // ADDITIVE (Slice 1): persisted traceability edges → stable public refs. Read-only, no schema change.
    const rcEvidenceRows = await db
      .selectFrom('businessbrain.bb_rc_evidence')
      .select(['root_cause_id', 'evidence_item_id'])
      .where('version_id', '=', vid)
      .execute();
    const recRootCauseRows = await db
      .selectFrom('businessbrain.bb_rec_rootcause')
      .select(['recommendation_id', 'root_cause_id'])
      .where('version_id', '=', vid)
      .execute();
    const actionRecRows = await db
      .selectFrom('businessbrain.bb_action_rec')
      .select(['action_id', 'recommendation_id'])
      .where('version_id', '=', vid)
      .execute();

    const built = buildTraceability({
      evidence: evidenceTrace,
      rootCauses: rootCauses.map((r: any) => ({ rootCauseId: r.root_cause_id })),
      recommendations: recommendations.map((r: any) => ({ recommendationId: r.recommendation_id })),
      actions: actionTrace,
      rcEvidence: rcEvidenceRows.map((r: any) => ({ rootCauseId: r.root_cause_id, evidenceItemId: r.evidence_item_id })),
      recRootCause: recRootCauseRows.map((r: any) => ({ recommendationId: r.recommendation_id, rootCauseId: r.root_cause_id })),
      actionRec: actionRecRows.map((r: any) => ({ actionId: r.action_id, recommendationId: r.recommendation_id })),
    });
    // FAIL CLOSED: a broken provenance edge must never be presented as a complete graph. On any integrity
    // violation we OMIT the (optional) traceability field — legacy fields stay intact so the Version is
    // still readable — and emit a structured server-side integrity log (never exposed to the client, and
    // carrying no internal ids in the public response).
    if (built.violations.length > 0) {
      // eslint-disable-next-line no-console
      console.error('[bb-traceability] integrity violation: traceability omitted', JSON.stringify({
        versionId: vid,
        violations: built.violations,
      }));
    }
    const traceability = built.traceability; // null when violations exist → omitted below

    return {
      versionId: vid,
      producedAt: new Date(version.promoted_at).toISOString(),
      ...(imp
        ? {
            importWindow: {
              from: imp.window_from ? new Date(imp.window_from).toISOString() : null,
              to: imp.window_to ? new Date(imp.window_to).toISOString() : null,
              postCount: imp.imported_post_count,
            },
          }
        : {}),
      businessReality: dv.business_reality,
      businessConsequences: consequences.map((r: any) => r.statement),
      evidence: { claims },
      cannotYetKnow: dv.cannot_yet_know,
      rootCauses: rootCauses.map((r: any) => r.statement),
      recommendations: recommendations.map((r: any) => r.statement),
      executionPlan: phases,
      ...(traceability ? { traceability } : {}), // additive + omitted on any integrity violation
    };
  }

  // ---- Lifecycle transactions ----

  async startRefresh(input: StartRefreshInput): Promise<StartRefreshResult> {
    return this.db.transaction().execute(async (trx: any) => {
      await lockFounder(trx, input.founderId, input.at);

      // Persistent, reload-safe Start Refresh idempotency (same token -> same operation).
      if (input.idempotencyToken) {
        const tokenRow = await trx
          .selectFrom('businessbrain.bb_start_refresh_idempotency')
          .selectAll()
          .where('founder_id', '=', input.founderId)
          .where('token', '=', input.idempotencyToken)
          .executeTakeFirst();
        if (tokenRow) {
          if (tokenRow.request_fingerprint !== (input.requestFingerprint ?? '')) {
            const snap = await readSnapshot(trx, input.founderId);
            return { created: false, kind: 'conflict', candidateVersionId: '', snapshot: snap };
          }
          const snap = await readSnapshot(trx, input.founderId);
          const active = await trx
            .selectFrom('businessbrain.bb_version')
            .select('version_id')
            .where('founder_id', '=', input.founderId)
            .where('lifecycle_status', '=', 'candidate')
            .executeTakeFirst();
          return { created: false, kind: 'replayed', candidateVersionId: active?.version_id ?? '', snapshot: snap };
        }
      }

      const existing = await trx
        .selectFrom('businessbrain.bb_version')
        .select('version_id')
        .where('founder_id', '=', input.founderId)
        .where('lifecycle_status', '=', 'candidate')
        .executeTakeFirst();
      if (existing) {
        const snap = await readSnapshot(trx, input.founderId);
        return { created: false, kind: 'in_progress', candidateVersionId: existing.version_id, snapshot: snap };
      }
      await trx
        .insertInto('businessbrain.bb_version')
        .values({
          version_id: input.versionId,
          founder_id: input.founderId,
          lifecycle_status: 'candidate',
          created_at: input.at,
          promoted_at: null,
        })
        .execute();
      await trx
        .insertInto('businessbrain.bb_import_job')
        .values({
          import_job_id: input.importJobId,
          version_id: input.versionId,
          founder_id: input.founderId,
          attempt_ordinal: 1,
          exec_state: 'queued',
          outcome: null,
          created_at: input.at,
        })
        .execute();
      await setRefresh(trx, input.founderId, input.at, {
        refresh_reference: input.refreshReference,
        candidate_version_id: input.versionId,
        refresh_state: 'in_progress',
        import_state: 'running',
        diagnosis_state: 'none',
        validation_state: 'none',
        failure_category: null,
        transition_marker: 1,
      });
      if (input.idempotencyToken) {
        await trx
          .insertInto('businessbrain.bb_start_refresh_idempotency')
          .values({
            founder_id: input.founderId,
            token: input.idempotencyToken,
            refresh_reference: input.refreshReference,
            request_fingerprint: input.requestFingerprint ?? '',
            created_at: input.at,
          })
          .execute();
      }
      await this.audit(trx, input.founderId, 'RefreshStarted', input.versionId, input.at, {
        refresh_state: 'in_progress',
      });
      const snap = await readSnapshot(trx, input.founderId);
      return { created: true, kind: 'created', candidateVersionId: input.versionId, snapshot: snap };
    });
  }

  async commitImportSufficient(input: CommitEvidenceInput): Promise<boolean> {
    return this.db.transaction().execute(async (trx: any) => {
      if (!(await isActiveCandidate(trx, input.founderId, input.versionId))) return false;
      const existingEv = await trx
        .selectFrom('businessbrain.bb_evidence_version')
        .select('evidence_version_id')
        .where('version_id', '=', input.versionId)
        .executeTakeFirst();
      if (existingEv) return true; // idempotent: import already committed (duplicate delivery)
      // Phase ②: persist the provenance store (import run + per-post observations) in the SAME tx.
      if (input.import) await insertImport(trx, input.founderId, input.versionId, input.import);
      if (input.observations?.length) await insertObservations(trx, input.founderId, input.versionId, input.import?.importId ?? '', input.observations);
      await insertEvidence(trx, input.founderId, input.versionId, input.evidence, input.at, input.windowDescriptor);
      await trx
        .updateTable('businessbrain.bb_import_job')
        .set({ exec_state: 'done', outcome: 'sufficient', ended_at: input.at })
        .where('import_job_id', '=', input.importJobId)
        .execute();
      await bumpRefresh(trx, input.founderId, input.at, { import_state: 'sufficient' });
      await this.audit(trx, input.founderId, 'ImportCommitted', input.versionId, input.at, {
        import_state: 'sufficient',
        item_count: input.evidence.items.length,
      });
      return true;
    });
  }

  async commitImportFailureAndDiscard(
    founderId: string,
    versionId: string,
    importOutcome: 'insufficient' | 'failed',
    failureCategory: FailureCategory,
    at: string,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx: any) => {
      await lockFounder(trx, founderId, at);
      await trx
        .updateTable('businessbrain.bb_import_job')
        .set({ exec_state: 'done', outcome: importOutcome, ended_at: at })
        .where('version_id', '=', versionId)
        .where('exec_state', '<>', 'done')
        .execute();
      await deleteCandidate(trx, founderId, versionId);
      await bumpRefresh(trx, founderId, at, {
        refresh_state: 'failed',
        import_state: importOutcome,
        diagnosis_state: 'none',
        validation_state: 'none',
        failure_category: failureCategory,
      });
      await this.audit(trx, founderId, 'CandidateDiscarded', versionId, at, { reason: importOutcome });
    });
  }

  async commitCandidateDiagnosis(input: CommitDiagnosisInput): Promise<boolean> {
    return this.db.transaction().execute(async (trx: any) => {
      if (!(await isActiveCandidate(trx, input.founderId, input.versionId))) return false;
      const ev = await trx
        .selectFrom('businessbrain.bb_evidence_version')
        .select('evidence_version_id')
        .where('version_id', '=', input.versionId)
        .executeTakeFirstOrThrow();

      const diagnosisVersionId = `${input.versionId}-dv`;
      await trx
        .insertInto('businessbrain.bb_diagnosis_version')
        .values({
          diagnosis_version_id: diagnosisVersionId,
          version_id: input.versionId,
          founder_id: input.founderId,
          evidence_version_ref: ev.evidence_version_id,
          business_reality: input.diagnosis.businessReality,
          cannot_yet_know: input.diagnosis.cannotYetKnow,
          created_at: input.at,
        })
        .execute();

      // Test seam: abort AFTER the header row to prove whole-diagnosis atomicity.
      if (input.failAfterHeader) throw new Error('forced_diagnosis_commit_failure');

      await insertDiagnosisBody(trx, input, diagnosisVersionId);

      // Phase ②: freeze the exact model input (context + SHA-256 + model/prompt provenance).
      if (input.generationContext) {
        const gc = input.generationContext;
        await trx
          .insertInto('businessbrain.bb_generation_context')
          .values({
            generation_context_id: gc.generationContextId,
            version_id: input.versionId,
            founder_id: input.founderId,
            context: gc.context ?? {},
            content_hash: gc.contentHash,
            model_id: gc.modelId ?? null,
            prompt_template_hash: gc.promptTemplateHash ?? null,
            created_at: input.at,
          })
          .execute();
      }

      await trx
        .insertInto('businessbrain.bb_diagnosis_job')
        .values({
          diagnosis_job_id: input.diagnosisJobId,
          version_id: input.versionId,
          founder_id: input.founderId,
          attempt_ordinal: 1,
          exec_state: 'done',
          outcome: null,
          validation_result: null,
          created_at: input.at,
          ended_at: input.at,
        })
        .execute();

      await bumpRefresh(trx, input.founderId, input.at, { diagnosis_state: 'produced' });
      await this.audit(trx, input.founderId, 'DiagnosisCompleted', input.versionId, input.at, {
        diagnosis_state: 'produced',
      });
      return true;
    });
  }

  async commitValidationPassed(founderId: string, versionId: string, at: string): Promise<void> {
    await this.db.transaction().execute(async (trx: any) => {
      await trx
        .updateTable('businessbrain.bb_diagnosis_job')
        .set({ outcome: 'valid', validation_result: 'passed' })
        .where('version_id', '=', versionId)
        .execute();
      await bumpRefresh(trx, founderId, at, { validation_state: 'passed' });
    });
  }

  async commitValidationFailedAndDiscard(founderId: string, versionId: string, at: string): Promise<void> {
    await this.db.transaction().execute(async (trx: any) => {
      await lockFounder(trx, founderId, at);
      await trx
        .updateTable('businessbrain.bb_diagnosis_job')
        .set({ outcome: 'validation_failed', validation_result: 'failed' })
        .where('version_id', '=', versionId)
        .execute();
      await deleteCandidate(trx, founderId, versionId);
      await bumpRefresh(trx, founderId, at, {
        refresh_state: 'failed',
        import_state: 'sufficient',
        diagnosis_state: 'produced',
        validation_state: 'failed',
        failure_category: 'diagnosis_unavailable',
      });
      await this.audit(trx, founderId, 'CandidateDiscarded', versionId, at, { reason: 'validation_failed' });
    });
  }

  async promoteCandidateAtomically(
    founderId: string,
    versionId: string,
    producedAt: string,
  ): Promise<'promoted' | 'stale'> {
    return this.db.transaction().execute(async (trx: any) => {
      await lockFounder(trx, founderId, producedAt);
      if (!(await isActiveCandidate(trx, founderId, versionId))) return 'stale';
      const status = await readRefreshRow(trx, founderId);
      const hasEvidence = await trx
        .selectFrom('businessbrain.bb_evidence_version')
        .select('evidence_version_id')
        .where('version_id', '=', versionId)
        .executeTakeFirst();
      const hasDiagnosis = await trx
        .selectFrom('businessbrain.bb_diagnosis_version')
        .select('diagnosis_version_id')
        .where('version_id', '=', versionId)
        .executeTakeFirst();
      if (!hasEvidence || !hasDiagnosis || status?.validation_state !== 'passed') return 'stale';

      const prior = await trx
        .selectFrom('businessbrain.bb_version')
        .select('version_id')
        .where('founder_id', '=', founderId)
        .where('lifecycle_status', '=', 'current')
        .executeTakeFirst();
      if (prior) {
        await trx
          .deleteFrom('businessbrain.bb_version')
          .where('version_id', '=', prior.version_id)
          .execute(); // cascade removes prior Current's artifacts
      }
      await trx
        .updateTable('businessbrain.bb_version')
        .set({ lifecycle_status: 'current', promoted_at: producedAt })
        .where('version_id', '=', versionId)
        .execute();
      if (this.failNextPromotion) {
        this.failNextPromotion = false;
        // Fail AFTER the destructive delete + role change: rollback must restore
        // the prior Current exactly and leave the Candidate un-promoted.
        throw new Error('forced_promotion_failure');
      }
      await bumpRefresh(trx, founderId, producedAt, { refresh_state: 'completed' });
      await this.audit(trx, founderId, 'VersionPromoted', versionId, producedAt, { refresh_state: 'completed' });
      if (prior) {
        await this.audit(trx, founderId, 'VersionSuperseded', prior.version_id, producedAt, {});
      }
      return 'promoted';
    });
  }

  async cancelAndDiscard(founderId: string, at: string): Promise<void> {
    await this.db.transaction().execute(async (trx: any) => {
      await lockFounder(trx, founderId, at);
      const candidate = await trx
        .selectFrom('businessbrain.bb_version')
        .select('version_id')
        .where('founder_id', '=', founderId)
        .where('lifecycle_status', '=', 'candidate')
        .executeTakeFirst();
      if (!candidate) return;
      await deleteCandidate(trx, founderId, candidate.version_id);
      await bumpRefresh(trx, founderId, at, { refresh_state: 'cancelled' });
      await this.audit(trx, founderId, 'CandidateDiscarded', candidate.version_id, at, { reason: 'cancelled' });
    });
  }

  async tryCommitStaleDiagnosis(founderId: string, staleVersionId: string, _at: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx: any) => {
      return isActiveCandidate(trx, founderId, staleVersionId);
    });
  }

  async failAndDiscard(
    founderId: string,
    versionId: string,
    failureCategory: FailureCategory,
    states: { importState?: string; diagnosisState?: string; validationState?: string },
    at: string,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx: any) => {
      await lockFounder(trx, founderId, at);
      await deleteCandidate(trx, founderId, versionId);
      await bumpRefresh(trx, founderId, at, {
        refresh_state: 'failed',
        failure_category: failureCategory,
        ...(states.importState ? { import_state: states.importState } : {}),
        ...(states.diagnosisState ? { diagnosis_state: states.diagnosisState } : {}),
        ...(states.validationState ? { validation_state: states.validationState } : {}),
      });
      await this.audit(trx, founderId, 'CandidateDiscarded', versionId, at, { reason: failureCategory });
    });
  }

  // ---- Real Instagram connection (reads the encrypted OAuth credential; NOT a dev adapter) ----

  /**
   * Connection presence is derived from the REAL encrypted credential in app.oauth_credentials
   * (provider 'instagram'), written by the Instagram Business Login OAuth callback. This is a
   * presence read only — the token is never selected, decrypted, or logged here. Connect/disconnect
   * are OWNED by the OAuth connector (apps/api), not this repository.
   */
  async getConnectionStatus(founderId: string): Promise<DevConnectionStatus> {
    const row = await (this.db as any)
      .selectFrom('app.oauth_credentials')
      .select(['created_at', 'updated_at'])
      .where('founder_id', '=', founderId)
      .where('provider', '=', 'instagram')
      .executeTakeFirst();
    if (!row) return { connectionState: 'not_connected' };
    const at = row.created_at ?? row.updated_at;
    return {
      connectionState: 'connected',
      ...(at ? { connectedAt: new Date(at).toISOString() } : {}),
    };
  }

  /**
   * On disconnect: never clears Current; discards an active Candidate as connection_lost so an
   * in-flight Refresh cannot promote a Version after the founder has revoked Instagram access.
   * Idempotent. The credential itself is removed by the OAuth connector, not here. This is a
   * concrete method (not on the lifecycle interface) called by the disconnect route.
   */
  async discardActiveCandidateOnDisconnect(founderId: string, at: string): Promise<void> {
    await this.db.transaction().execute(async (trx: any) => {
      await lockFounder(trx, founderId, at);
      const candidate = await trx
        .selectFrom('businessbrain.bb_version')
        .select('version_id')
        .where('founder_id', '=', founderId)
        .where('lifecycle_status', '=', 'candidate')
        .executeTakeFirst();
      if (candidate) {
        await deleteCandidate(trx, founderId, candidate.version_id);
        await bumpRefresh(trx, founderId, at, { refresh_state: 'failed', failure_category: 'connection_lost' });
        await this.audit(trx, founderId, 'CandidateDiscarded', candidate.version_id, at, { reason: 'connection_lost' });
      }
    });
  }
}

// ---- helpers ----

async function lockFounder(trx: any, founderId: string, at: string): Promise<void> {
  await trx
    .insertInto('businessbrain.bb_refresh_status')
    .values({
      founder_id: founderId,
      refresh_reference: null,
      candidate_version_id: null,
      refresh_state: 'none',
      import_state: 'none',
      diagnosis_state: 'none',
      validation_state: 'none',
      failure_category: null,
      transition_marker: 0,
      updated_at: at,
    })
    .onConflict((oc: any) => oc.column('founder_id').doNothing())
    .execute();
  await trx
    .selectFrom('businessbrain.bb_refresh_status')
    .select('founder_id')
    .where('founder_id', '=', founderId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}

async function isActiveCandidate(trx: any, founderId: string, versionId: string): Promise<boolean> {
  const row = await trx
    .selectFrom('businessbrain.bb_version')
    .select('version_id')
    .where('founder_id', '=', founderId)
    .where('version_id', '=', versionId)
    .where('lifecycle_status', '=', 'candidate')
    .executeTakeFirst();
  return !!row;
}

async function deleteCandidate(trx: any, founderId: string, versionId: string): Promise<void> {
  await trx
    .deleteFrom('businessbrain.bb_version')
    .where('founder_id', '=', founderId)
    .where('version_id', '=', versionId)
    .where('lifecycle_status', '=', 'candidate')
    .execute(); // cascade removes jobs, evidence, diagnosis, joins
}

async function readRefreshRow(trx: any, founderId: string): Promise<any> {
  return trx
    .selectFrom('businessbrain.bb_refresh_status')
    .selectAll()
    .where('founder_id', '=', founderId)
    .executeTakeFirst();
}

async function readSnapshot(trx: any, founderId: string): Promise<PublicRefreshSnapshot> {
  const r = await readRefreshRow(trx, founderId);
  return r ? snapshotOf(r) : NONE_SNAPSHOT;
}

function snapshotOf(r: any): PublicRefreshSnapshot {
  return {
    ...(r.refresh_reference ? { refreshReference: r.refresh_reference } : {}),
    refreshState: r.refresh_state,
    importState: r.import_state,
    diagnosisState: r.diagnosis_state,
    validationState: r.validation_state,
    ...(r.failure_category ? { failureCategory: r.failure_category } : {}),
    transitionMarker: Number(r.transition_marker),
  };
}

async function setRefresh(
  trx: any,
  founderId: string,
  at: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await trx
    .updateTable('businessbrain.bb_refresh_status')
    .set({ ...fields, updated_at: at })
    .where('founder_id', '=', founderId)
    .execute();
}

/** Update selected refresh fields and increment the monotonic transition marker. */
async function bumpRefresh(
  trx: any,
  founderId: string,
  at: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const current = await readRefreshRow(trx, founderId);
  const marker = current ? Number(current.transition_marker) + 1 : 1;
  await trx
    .updateTable('businessbrain.bb_refresh_status')
    .set({ ...fields, transition_marker: marker, updated_at: at })
    .where('founder_id', '=', founderId)
    .execute();
}

// Phase ②: persist the import run (account snapshot + window) for one Version.
async function insertImport(trx: any, founderId: string, versionId: string, imp: ImportRecordInput): Promise<void> {
  await trx
    .insertInto('businessbrain.bb_import')
    .values({
      import_id: imp.importId,
      version_id: versionId,
      founder_id: founderId,
      source: imp.source,
      account_external_id: imp.accountExternalId,
      account_username: imp.accountUsername,
      account_type: imp.accountType,
      followers_count: imp.followersCount,
      media_count: imp.mediaCount,
      imported_post_count: imp.importedPostCount,
      window_from: imp.windowFrom,
      window_to: imp.windowTo,
      imported_at: imp.importedAt,
    })
    .execute();
}

// Phase ②: persist the per-post observations (full caption + deterministic signals + real metrics).
async function insertObservations(
  trx: any,
  founderId: string,
  versionId: string,
  importId: string,
  observations: readonly ObservationInput[],
): Promise<void> {
  for (const o of observations) {
    await trx
      .insertInto('businessbrain.bb_observation')
      .values({
        observation_id: o.observationId,
        import_id: importId,
        version_id: versionId,
        founder_id: founderId,
        post_external_id: o.postExternalId,
        permalink: o.permalink,
        media_type: o.mediaType,
        posted_at: o.postedAt,
        reach: o.reach,
        likes: o.likes,
        comments: o.comments,
        caption: o.caption,
        caption_length: o.captionLength,
        word_count: o.wordCount,
        hashtag_count: o.hashtagCount,
        mention_count: o.mentionCount,
        has_link: o.hasLink,
        has_cta: o.hasCta,
      })
      .execute();
  }
}

async function insertEvidence(
  trx: any,
  founderId: string,
  versionId: string,
  evidence: EvidenceVersion,
  at: string,
  windowDescriptor?: string,
): Promise<void> {
  await trx
    .insertInto('businessbrain.bb_evidence_version')
    .values({
      evidence_version_id: evidence.evidenceVersionId,
      version_id: versionId,
      founder_id: founderId,
      item_count: evidence.items.length,
      window_descriptor: windowDescriptor ?? null,
      created_at: at,
    })
    .execute();
  for (const item of evidence.items) {
    await trx
      .insertInto('businessbrain.bb_evidence_item')
      .values({
        evidence_item_id: item.evidenceItemId,
        evidence_version_id: evidence.evidenceVersionId,
        version_id: versionId,
        founder_id: founderId,
        kind: item.kind,
        measure_value: item.value ?? null,
        claim_label: item.claimLabel,
        provenance: item.provenance ?? null, // Phase ②: jsonb {source, metricKey, observationRefs}
        created_at: at,
      })
      .execute();
  }
}

async function insertDiagnosisBody(
  trx: any,
  input: CommitDiagnosisInput,
  diagnosisVersionId: string,
): Promise<void> {
  const { founderId, versionId, diagnosis, at } = input;
  const d: DiagnosisContent = diagnosis;

  // Evidence Section claims + measures (projection of Evidence Items).
  let claimIdx = 0;
  for (const claim of d.evidenceClaims) {
    const claimId = `${versionId}-ec-${claimIdx}`;
    await trx
      .insertInto('businessbrain.bb_evidence_claim')
      .values({
        evidence_claim_id: claimId,
        diagnosis_version_id: diagnosisVersionId,
        version_id: versionId,
        founder_id: founderId,
        ordinal: claimIdx,
        claim_statement: claim.claimStatement,
        created_at: at,
      })
      .execute();
    // Map measures to Evidence Items by descriptor+kind (the fixture's stable mapping).
    let mIdx = 0;
    for (const measure of claim.measures) {
      const itemRow = await trx
        .selectFrom('businessbrain.bb_evidence_item')
        .select('evidence_item_id')
        .where('version_id', '=', versionId)
        .where('claim_label', '=', measure.descriptor)
        .where('kind', '=', measure.kind)
        .executeTakeFirst();
      if (itemRow) {
        await trx
          .insertInto('businessbrain.bb_evidence_claim_measure')
          .values({
            evidence_claim_id: claimId,
            evidence_item_id: itemRow.evidence_item_id,
            version_id: versionId,
            founder_id: founderId,
            ordinal: mIdx,
          })
          .execute();
      }
      mIdx += 1;
    }
    claimIdx += 1;
  }

  let cIdx = 0;
  for (const c of d.businessConsequences) {
    await trx
      .insertInto('businessbrain.bb_business_consequence')
      .values({
        id: `${versionId}-bc-${cIdx}`,
        diagnosis_version_id: diagnosisVersionId,
        version_id: versionId,
        founder_id: founderId,
        ordinal: cIdx,
        statement: c,
        created_at: at,
      })
      .execute();
    cIdx += 1;
  }

  let rcIdx = 0;
  for (const rc of d.rootCauses) {
    await trx
      .insertInto('businessbrain.bb_root_cause')
      .values({
        root_cause_id: rc.rootCauseId,
        diagnosis_version_id: diagnosisVersionId,
        version_id: versionId,
        founder_id: founderId,
        ordinal: rcIdx,
        statement: rc.statement,
        created_at: at,
      })
      .execute();
    for (const eid of rc.evidenceItemIds) {
      await trx
        .insertInto('businessbrain.bb_rc_evidence')
        .values({ root_cause_id: rc.rootCauseId, evidence_item_id: eid, version_id: versionId, founder_id: founderId })
        .execute();
    }
    rcIdx += 1;
  }

  let recIdx = 0;
  for (const rec of d.recommendations) {
    await trx
      .insertInto('businessbrain.bb_recommendation')
      .values({
        recommendation_id: rec.recommendationId,
        diagnosis_version_id: diagnosisVersionId,
        version_id: versionId,
        founder_id: founderId,
        ordinal: recIdx,
        statement: rec.statement,
        created_at: at,
      })
      .execute();
    for (const rid of rec.rootCauseIds) {
      await trx
        .insertInto('businessbrain.bb_rec_rootcause')
        .values({ recommendation_id: rec.recommendationId, root_cause_id: rid, version_id: versionId, founder_id: founderId })
        .execute();
    }
    recIdx += 1;
  }

  const planId = `${versionId}-epv`;
  await trx
    .insertInto('businessbrain.bb_execution_plan_version')
    .values({
      execution_plan_version_id: planId,
      version_id: versionId,
      founder_id: founderId,
      diagnosis_version_ref: diagnosisVersionId,
      created_at: at,
    })
    .execute();
  let phaseIdx = 0;
  for (const phase of d.executionPlan) {
    for (const action of phase.actions) {
      await trx
        .insertInto('businessbrain.bb_execution_plan_action')
        .values({
          action_id: action.actionId,
          execution_plan_version_id: planId,
          version_id: versionId,
          founder_id: founderId,
          phase_label: phase.label,
          phase_ordinal: phaseIdx,
          sequence: action.sequence,
          statement: action.statement,
          created_at: at,
        })
        .execute();
      for (const rid of action.recommendationIds) {
        await trx
          .insertInto('businessbrain.bb_action_rec')
          .values({ action_id: action.actionId, recommendation_id: rid, version_id: versionId, founder_id: founderId })
          .execute();
      }
    }
    phaseIdx += 1;
  }
}

