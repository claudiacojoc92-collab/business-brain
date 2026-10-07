/**
 * LIVE PostgreSQL integration harness for V060 + PgBusinessBrainRepository.
 *
 * Env-gated: runs ONLY when BB_IT_DATABASE_URL is set (a throwaway database).
 * The `.integration.spec.ts` suffix keeps it out of the default vitest glob.
 * Schema comes from the real Flyway migration; the suite seeds isolated Founders.
 *
 * Run where PostgreSQL is available:
 *   docker compose -f docker-compose.test.yml up -d postgres-test
 *   docker compose -f docker-compose.test.yml run --rm migrate-test
 *   BB_IT_DATABASE_URL=postgresql://bbuser:bbpassword@localhost:5433/businessbrain_test \
 *     npx vitest run packages/infrastructure/src/__tests__/database/repositories/pg-businessbrain.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import {
  generateId,
  // pure domain reference (shared with the in-memory slice)
} from '@bb/shared';
import {
  validateCandidate,
  isCoherentSnapshot,
  buildDeterministicEvidence,
  computeAccountMetrics,
  computePostSignals,
} from '@bb/application';
import type { DiagnosisContent, EvidenceVersion, ImportedAccount, ObservationRecord } from '@bb/application';
import { createKyselyClient, type KyselyDB } from '../../../database/client';
import { PgBusinessBrainRepository } from '../../../businessbrain/pg-businessbrain.repository';

// ── Local shims: preserve the old fixture call-shape but build from the REAL deterministic path.
//    (Phase ② removed the product fixtures; these test doubles feed the repo valid/invalid content.) ──
type DiagnosisFlaw = 'none' | 'omit_cannot_yet_know' | 'metric_in_reality';
function fakeAccount(n: number): ImportedAccount {
  const base = Date.parse('2025-01-01T00:00:00.000Z');
  const posts = Array.from({ length: n }, (_, i) => ({
    postExternalId: `m${i}`, permalink: `https://instagram.com/p/m${i}`,
    mediaType: i % 3 === 0 ? 'VIDEO' : 'IMAGE', postedAt: new Date(base + i * 3 * 86_400_000).toISOString(),
    caption: i % 2 === 0 ? 'A day in my life ✨ #life' : 'Behind the scenes of my work. link in bio',
    reach: 100 + i, likes: 10 + i, comments: i % 4,
  }));
  return { accountExternalId: 'ig1', username: 'founder', accountType: 'BUSINESS', followersCount: 1200, mediaCount: n, posts, importedAt: '2025-07-01T00:00:00.000Z' };
}
function deterministicImport(mode: 'sufficient' | 'insufficient'): 'sufficient' | 'insufficient' { return mode; }
function constructEvidence(versionId: string, founderId: string, mode: 'sufficient' | 'insufficient'): { sufficient: boolean; evidence?: EvidenceVersion } {
  const acct = fakeAccount(mode === 'insufficient' ? 1 : 12);
  const obs: ObservationRecord[] = acct.posts.map((p, i) => ({ observationId: `${versionId}-o-${i}`, ...p, ...computePostSignals(p.caption) }));
  const metrics = computeAccountMetrics(obs, acct.followersCount);
  const built = buildDeterministicEvidence(versionId, founderId, metrics, obs);
  return { sufficient: built.sufficient, ...(built.evidence ? { evidence: built.evidence } : {}) };
}
function deterministicDiagnosis(versionId: string, evidence: EvidenceVersion, flaw: DiagnosisFlaw): DiagnosisContent {
  const first = evidence.items[0]!;
  const rootCause = { rootCauseId: `${versionId}-rc-1`, versionId, statement: 'Your offer is not made plain enough for people to act on it.', evidenceItemIds: [first.evidenceItemId] };
  const rec = { recommendationId: `${versionId}-rec-1`, versionId, statement: 'State your offer clearly and invite people to take one next step.', rootCauseIds: [rootCause.rootCauseId] };
  const action = { actionId: `${versionId}-a-1`, versionId, statement: 'Introduce a recurring, clear invitation to work with you.', sequence: 1, recommendationIds: [rec.recommendationId] };
  return {
    businessReality: flaw === 'metric_in_reality' ? 'Your business converts 87 of every hundred admirers into nothing.' : 'Your business is hard for the right buyers to recognise and choose.',
    businessConsequences: ['The right customers rarely realise you can help them.', 'People who like you have no clear way to become buyers.'],
    evidenceClaims: [{ claimStatement: 'What your recent activity shows', measures: evidence.items.map((it) => ({ descriptor: it.claimLabel, kind: it.kind, ...(it.value !== undefined ? { value: it.value } : {}) })) }],
    cannotYetKnow: flaw === 'omit_cannot_yet_know' ? '' : 'We cannot yet see your actual sales, or what your audience privately thinks.',
    rootCauses: [rootCause], recommendations: [rec], executionPlan: [{ label: 'Weeks one to four', actions: [action] }],
  };
}

const URL = process.env.BB_IT_DATABASE_URL;
const AT = '2025-01-06T04:00:00.000Z';
const suite = URL ? describe : describe.skip;

suite('LIVE Postgres — V060 + PgBusinessBrainRepository', () => {
  let pool: Pool;
  let db: KyselyDB;
  let repo: PgBusinessBrainRepository;
  let founderId: string;

  const seededFounders: string[] = [];

  async function seedFounder(): Promise<string> {
    const id = generateId();
    await pool.query(
      `INSERT INTO founder.founders (id, email, name, business_name) VALUES ($1,$2,$3,$4)`,
      [id, `${id}@it.test`, 'IT Founder', 'IT Business'],
    );
    seededFounders.push(id);
    return id;
  }

  async function count(table: string, where: string, params: unknown[]): Promise<number> {
    const r = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
    return r.rows[0].n as number;
  }

  /** startRefresh + a sufficient import; returns the persisted candidate versionId + evidence. */
  async function startAndImport(): Promise<{ versionId: string; evidence: ReturnType<typeof constructEvidence>['evidence'] }> {
    const versionId = generateId();
    const importJobId = generateId();
    const start = await repo.startRefresh({ founderId, versionId, refreshReference: generateId(), importJobId, at: AT });
    expect(start.created).toBe(true);
    const ev = constructEvidence(versionId, founderId, deterministicImport('sufficient'));
    await repo.commitImportSufficient({ founderId, versionId, evidence: ev.evidence!, importJobId, at: AT });
    return { versionId, evidence: ev.evidence };
  }

  /** Full happy path -> 'promoted'. */
  async function runHappy(): Promise<string> {
    const { versionId, evidence } = await startAndImport();
    const diagnosis = deterministicDiagnosis(versionId, evidence!, 'none');
    const ok = await repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis, diagnosisJobId: generateId(), at: AT });
    expect(ok).toBe(true);
    await repo.commitValidationPassed(founderId, versionId, AT);
    const promo = await repo.promoteCandidateAtomically(founderId, versionId, AT);
    expect(promo).toBe('promoted');
    return versionId;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    db = createKyselyClient(URL!);
    repo = new PgBusinessBrainRepository(db);
  });

  afterAll(async () => {
    if (seededFounders.length) {
      await pool.query(`DELETE FROM founder.founders WHERE id = ANY($1)`, [seededFounders]);
    }
    await db.destroy();
    await pool.end();
  });

  beforeEach(async () => {
    founderId = await seedFounder();
    repo.failNextPromotion = false;
    repo.failNextAudit = false;
  });

  it('1. a new Founder has no Current Version', async () => {
    expect(await repo.getCurrentAggregate(founderId)).toBeNull();
    expect((await repo.getRefreshProgress(founderId)).refreshState).toBe('none');
  });

  it('2. Start Refresh persists one Candidate and one Refresh Status Record', async () => {
    await repo.startRefresh({ founderId, versionId: generateId(), refreshReference: generateId(), importJobId: generateId(), at: AT });
    expect(await count('businessbrain.bb_version', "founder_id=$1 AND lifecycle_status='candidate'", [founderId])).toBe(1);
    const snap = await repo.getRefreshProgress(founderId);
    expect(snap.refreshState).toBe('in_progress');
    expect(snap.refreshReference).toBeTruthy();
  });

  it('3. two concurrent Start Refresh operations result in one Candidate', async () => {
    const mk = () => repo.startRefresh({ founderId, versionId: generateId(), refreshReference: generateId(), importJobId: generateId(), at: AT });
    const [a, b] = await Promise.all([mk(), mk()]);
    const created = [a, b].filter((r) => r.created).length;
    expect(created).toBe(1);
    expect(await count('businessbrain.bb_version', "founder_id=$1 AND lifecycle_status='candidate'", [founderId])).toBe(1);
  });

  it('4. duplicate Start Refresh cannot create a second Candidate', async () => {
    await repo.startRefresh({ founderId, versionId: generateId(), refreshReference: generateId(), importJobId: generateId(), at: AT });
    const second = await repo.startRefresh({ founderId, versionId: generateId(), refreshReference: generateId(), importJobId: generateId(), at: AT });
    expect(second.created).toBe(false);
    expect(await count('businessbrain.bb_version', "founder_id=$1 AND lifecycle_status='candidate'", [founderId])).toBe(1);
  });

  it('5. Import Completion persists one Evidence Version and its items atomically', async () => {
    const { versionId } = await startAndImport();
    expect(await count('businessbrain.bb_evidence_version', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_evidence_item', 'version_id=$1', [versionId])).toBe(9);
  });

  it('6. duplicate Import completion creates no duplicate Evidence', async () => {
    const versionId = generateId();
    const importJobId = generateId();
    await repo.startRefresh({ founderId, versionId, refreshReference: generateId(), importJobId, at: AT });
    const ev = constructEvidence(versionId, founderId, deterministicImport('sufficient'));
    await repo.commitImportSufficient({ founderId, versionId, evidence: ev.evidence!, importJobId, at: AT });
    await repo.commitImportSufficient({ founderId, versionId, evidence: ev.evidence!, importJobId, at: AT }); // duplicate
    expect(await count('businessbrain.bb_evidence_version', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_evidence_item', 'version_id=$1', [versionId])).toBe(9);
  });

  it('7. Diagnosis Completion persists the complete diagnosis, plan, and joins atomically', async () => {
    const { versionId, evidence } = await startAndImport();
    const diagnosis = deterministicDiagnosis(versionId, evidence!, 'none');
    await repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis, diagnosisJobId: generateId(), at: AT });
    expect(await count('businessbrain.bb_diagnosis_version', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_business_consequence', 'version_id=$1', [versionId])).toBe(2);
    expect(await count('businessbrain.bb_root_cause', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_recommendation', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_execution_plan_version', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_execution_plan_action', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_rc_evidence', 'version_id=$1', [versionId])).toBeGreaterThanOrEqual(1);
    expect(await count('businessbrain.bb_rec_rootcause', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_action_rec', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_evidence_claim', 'version_id=$1', [versionId])).toBe(1);
    expect(await count('businessbrain.bb_evidence_claim_measure', 'version_id=$1', [versionId])).toBe(9);
  });

  it('8. partial diagnosis persistence is impossible when the transaction fails', async () => {
    const { versionId, evidence } = await startAndImport();
    const diagnosis = deterministicDiagnosis(versionId, evidence!, 'none');
    await expect(
      repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis, diagnosisJobId: generateId(), at: AT, failAfterHeader: true }),
    ).rejects.toThrow();
    // The header row and all body rows rolled back together.
    expect(await count('businessbrain.bb_diagnosis_version', 'version_id=$1', [versionId])).toBe(0);
    expect(await count('businessbrain.bb_root_cause', 'version_id=$1', [versionId])).toBe(0);
  });

  it('9. Validation rejects missing Cannot Yet Know', () => {
    const versionId = 'V';
    const evidence = constructEvidence(versionId, founderId, deterministicImport('sufficient')).evidence!;
    const d = deterministicDiagnosis(versionId, evidence, 'omit_cannot_yet_know');
    const r = validateCandidate({ versionId, founderId, evidence, diagnosis: d });
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('missing_cannot_yet_know');
  });

  it('10. Validation rejects metric/channel terminology outside Evidence', () => {
    const versionId = 'V';
    const evidence = constructEvidence(versionId, founderId, deterministicImport('sufficient')).evidence!;
    const d = deterministicDiagnosis(versionId, evidence, 'metric_in_reality');
    const r = validateCandidate({ versionId, founderId, evidence, diagnosis: d });
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('metric_in_business_reality');
  });

  it('11. Validation rejects incomplete traceability, and Current is unchanged', async () => {
    const priorNull = await repo.getCurrentAggregate(founderId);
    expect(priorNull).toBeNull();
    const { versionId, evidence } = await startAndImport();
    const d = deterministicDiagnosis(versionId, evidence!, 'none');
    const broken = { ...d, rootCauses: [{ ...d.rootCauses[0]!, evidenceItemIds: [] as string[] }] };
    const r = validateCandidate({ versionId, founderId, evidence: evidence!, diagnosis: broken });
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('root_cause_without_evidence');
    await repo.commitValidationFailedAndDiscard(founderId, versionId, AT);
    expect(await repo.getCurrentAggregate(founderId)).toBeNull(); // unchanged
    expect(await repo.getActiveCandidateVersionId(founderId)).toBeNull(); // discarded
  });

  it('12. cross-Version traceability is rejected at the database level', async () => {
    // Version A with a root cause; try to join it to Version B's evidence item.
    const a = await startAndImport();
    const b = await (async () => {
      // second Founder for an independent Version B (avoid one-candidate clash)
      const otherFounder = await seedFounder();
      const vid = generateId();
      const jobId = generateId();
      await repo.startRefresh({ founderId: otherFounder, versionId: vid, refreshReference: generateId(), importJobId: jobId, at: AT });
      const ev = constructEvidence(vid, otherFounder, deterministicImport('sufficient'));
      await repo.commitImportSufficient({ founderId: otherFounder, versionId: vid, evidence: ev.evidence!, importJobId: jobId, at: AT });
      return { versionId: vid, itemId: ev.evidence!.items[0]!.evidenceItemId };
    })();
    // Persist A's diagnosis (so A has a root cause row).
    const dA = deterministicDiagnosis(a.versionId, a.evidence!, 'none');
    await repo.commitCandidateDiagnosis({ founderId, versionId: a.versionId, diagnosis: dA, diagnosisJobId: generateId(), at: AT });
    const rootCauseId = `${a.versionId}-rc-1`;
    // Cross-version join insert must violate the composite FK.
    await expect(
      pool.query(
        `INSERT INTO businessbrain.bb_rc_evidence (root_cause_id, evidence_item_id, version_id, founder_id) VALUES ($1,$2,$3,$4)`,
        [rootCauseId, b.itemId, a.versionId, founderId],
      ),
    ).rejects.toThrow();
  });

  it('13. successful Promotion results in exactly one Current', async () => {
    const vid = await runHappy();
    expect(await count('businessbrain.bb_version', "founder_id=$1 AND lifecycle_status='current'", [founderId])).toBe(1);
    const cur = await repo.getCurrentAggregate(founderId);
    expect(cur?.versionId).toBe(vid);
    expect((await repo.getRefreshProgress(founderId)).refreshState).toBe('completed');
  });

  it('14. Promotion physically removes the prior Current and its dependent artifacts', async () => {
    const v1 = await runHappy();
    const v2 = await runHappy();
    expect(await count('businessbrain.bb_version', 'version_id=$1', [v1])).toBe(0); // prior gone
    expect(await count('businessbrain.bb_evidence_version', 'version_id=$1', [v1])).toBe(0); // cascade
    expect(await count('businessbrain.bb_diagnosis_version', 'version_id=$1', [v1])).toBe(0);
    expect(await count('businessbrain.bb_version', "founder_id=$1 AND lifecycle_status='current'", [founderId])).toBe(1);
    expect((await repo.getCurrentAggregate(founderId))?.versionId).toBe(v2);
  });

  it('15. Promotion failure leaves the prior Current completely intact', async () => {
    const v1 = await runHappy();
    const { versionId: v2, evidence } = await startAndImport();
    const d = deterministicDiagnosis(v2, evidence!, 'none');
    await repo.commitCandidateDiagnosis({ founderId, versionId: v2, diagnosis: d, diagnosisJobId: generateId(), at: AT });
    await repo.commitValidationPassed(founderId, v2, AT);
    repo.failNextPromotion = true;
    await expect(repo.promoteCandidateAtomically(founderId, v2, AT)).rejects.toThrow();
    // v1 remains Current; v2 remains Candidate (rollback undid delete + role change).
    expect((await repo.getCurrentAggregate(founderId))?.versionId).toBe(v1);
    expect(await count('businessbrain.bb_version', "version_id=$1 AND lifecycle_status='current'", [v1])).toBe(1);
    expect(await count('businessbrain.bb_version', "version_id=$1 AND lifecycle_status='candidate'", [v2])).toBe(1);
  });

  it('16. Candidate is not Current before Promotion commits', async () => {
    const { versionId, evidence } = await startAndImport();
    const d = deterministicDiagnosis(versionId, evidence!, 'none');
    await repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis: d, diagnosisJobId: generateId(), at: AT });
    await repo.commitValidationPassed(founderId, versionId, AT);
    expect(await repo.getCurrentAggregate(founderId)).toBeNull(); // still no Current
    expect(await repo.getActiveCandidateVersionId(founderId)).toBe(versionId);
  });

  it('17. Candidate Discard deletes Candidate artifacts, joins, and Jobs', async () => {
    const { versionId, evidence } = await startAndImport();
    const d = deterministicDiagnosis(versionId, evidence!, 'none');
    await repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis: d, diagnosisJobId: generateId(), at: AT });
    await repo.cancelAndDiscard(founderId, AT);
    for (const t of [
      'bb_version', 'bb_import_job', 'bb_diagnosis_job', 'bb_evidence_version', 'bb_evidence_item',
      'bb_diagnosis_version', 'bb_root_cause', 'bb_recommendation', 'bb_execution_plan_action',
      'bb_rc_evidence', 'bb_rec_rootcause', 'bb_action_rec', 'bb_evidence_claim', 'bb_evidence_claim_measure',
    ]) {
      expect(await count(`businessbrain.${t}`, 'version_id=$1', [versionId])).toBe(0);
    }
  });

  it('18. Candidate Discard never touches Current', async () => {
    const v1 = await runHappy();
    await startAndImport(); // v2 candidate
    await repo.cancelAndDiscard(founderId, AT);
    expect((await repo.getCurrentAggregate(founderId))?.versionId).toBe(v1);
  });

  it('19. a stale worker completion after Candidate Discard writes nothing', async () => {
    const { versionId, evidence } = await startAndImport();
    await repo.cancelAndDiscard(founderId, AT);
    expect(await repo.tryCommitStaleDiagnosis(founderId, versionId, AT)).toBe(false);
    const d = deterministicDiagnosis(versionId, evidence!, 'none');
    const wrote = await repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis: d, diagnosisJobId: generateId(), at: AT });
    expect(wrote).toBe(false); // stale guard
    expect(await count('businessbrain.bb_diagnosis_version', 'version_id=$1', [versionId])).toBe(0);
  });

  it('20. Refresh Progress remains one coherent snapshot', async () => {
    expect(isCoherentSnapshot(await repo.getRefreshProgress(founderId))).toBe(true); // none
    const s1 = await repo.startRefresh({ founderId, versionId: generateId(), refreshReference: generateId(), importJobId: generateId(), at: AT });
    expect(isCoherentSnapshot(s1.snapshot)).toBe(true); // in_progress|running|none|none
    await runHappyFrom(founderId, s1.candidateVersionId); // drive to completed
    expect(isCoherentSnapshot(await repo.getRefreshProgress(founderId))).toBe(true);
    expect((await repo.getRefreshProgress(founderId)).refreshState).toBe('completed');
  });

  it('21. transition_marker increases monotonically within one Refresh', async () => {
    const markers: number[] = [];
    const versionId = generateId();
    const importJobId = generateId();
    await repo.startRefresh({ founderId, versionId, refreshReference: generateId(), importJobId, at: AT });
    markers.push((await repo.getRefreshProgress(founderId)).transitionMarker);
    const ev = constructEvidence(versionId, founderId, deterministicImport('sufficient'));
    await repo.commitImportSufficient({ founderId, versionId, evidence: ev.evidence!, importJobId, at: AT });
    markers.push((await repo.getRefreshProgress(founderId)).transitionMarker);
    const d = deterministicDiagnosis(versionId, ev.evidence!, 'none');
    await repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis: d, diagnosisJobId: generateId(), at: AT });
    markers.push((await repo.getRefreshProgress(founderId)).transitionMarker);
    await repo.commitValidationPassed(founderId, versionId, AT);
    markers.push((await repo.getRefreshProgress(founderId)).transitionMarker);
    await repo.promoteCandidateAtomically(founderId, versionId, AT);
    markers.push((await repo.getRefreshProgress(founderId)).transitionMarker);
    for (let i = 1; i < markers.length; i += 1) {
      expect(markers[i]!).toBeGreaterThan(markers[i - 1]!);
    }
  });

  it('22. every persisted artifact is Founder-consistent and Version-consistent', async () => {
    const vid = await runHappy();
    for (const t of [
      'bb_evidence_version', 'bb_evidence_item', 'bb_diagnosis_version', 'bb_business_consequence',
      'bb_root_cause', 'bb_recommendation', 'bb_execution_plan_version', 'bb_execution_plan_action',
      'bb_rc_evidence', 'bb_rec_rootcause', 'bb_action_rec', 'bb_evidence_claim', 'bb_evidence_claim_measure',
    ]) {
      const wrong = await count(`businessbrain.${t}`, 'version_id=$1 AND founder_id<>$2', [vid, founderId]);
      expect(wrong).toBe(0);
    }
  });

  it('23. no direct Execution Plan Version -> Root Cause persistence path exists', async () => {
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='businessbrain' AND table_name LIKE '%plan%root%'`,
    );
    expect(tables.rowCount).toBe(0);
    // No FK from plan tables to bb_root_cause.
    const fks = await pool.query(`
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='businessbrain'
        AND tc.table_name IN ('bb_execution_plan_version','bb_execution_plan_action')
        AND ccu.table_name='bb_root_cause'`);
    expect(fks.rowCount).toBe(0);
  });

  it('24. Audit-event failure aborts the associated lifecycle transition', async () => {
    const { versionId, evidence } = await startAndImport();
    const d = deterministicDiagnosis(versionId, evidence!, 'none');
    await repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis: d, diagnosisJobId: generateId(), at: AT });
    await repo.commitValidationPassed(founderId, versionId, AT);
    repo.failNextAudit = true;
    await expect(repo.promoteCandidateAtomically(founderId, versionId, AT)).rejects.toThrow();
    // Transition rolled back: not promoted, still Candidate, no Current, no promote audit row.
    expect(await repo.getCurrentAggregate(founderId)).toBeNull();
    expect(await repo.getActiveCandidateVersionId(founderId)).toBe(versionId);
    expect(await count('audit.audit_log', "resource_id=$1 AND event_type='businessbrain.VersionPromoted'", [versionId])).toBe(0);
  });

  /** Helper used by test 20: drive an already-started candidate to completion. */
  async function runHappyFrom(fid: string, versionId: string): Promise<void> {
    const evidence = constructEvidence(versionId, fid, deterministicImport('sufficient')).evidence!;
    // import job id is unknown here; commitImportSufficient marks by version — supply a fresh id is not needed
    // because the started import job for this candidate is already 'queued'. Mark it via its version.
    await markImportDoneAndCommit(fid, versionId, evidence);
    const d = deterministicDiagnosis(versionId, evidence, 'none');
    await repo.commitCandidateDiagnosis({ founderId: fid, versionId, diagnosis: d, diagnosisJobId: generateId(), at: AT });
    await repo.commitValidationPassed(fid, versionId, AT);
    await repo.promoteCandidateAtomically(fid, versionId, AT);
  }

  async function markImportDoneAndCommit(fid: string, versionId: string, evidence: NonNullable<ReturnType<typeof constructEvidence>['evidence']>): Promise<void> {
    const job = await pool.query(
      `SELECT import_job_id FROM businessbrain.bb_import_job WHERE version_id=$1 AND exec_state<>'done' LIMIT 1`,
      [versionId],
    );
    const importJobId = job.rows[0]?.import_job_id as string;
    await repo.commitImportSufficient({ founderId: fid, versionId, evidence, importJobId, at: AT });
  }
});
