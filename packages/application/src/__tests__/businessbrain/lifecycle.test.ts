/**
 * Business Brain V1 — core business lifecycle vertical slice (deterministic).
 * Proves: no Current -> Start Refresh -> internal Candidate -> Import ->
 * Evidence -> Diagnosis -> Validation -> atomic Promotion -> new Current,
 * Candidate never externally readable. Runs with no database.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockClock } from '@bb/shared';

import { RefreshCoordinationService } from '../../businessbrain/coordination/refresh-coordination.service';
import { BusinessBrainStore } from '../../businessbrain/coordination/store';
import { validateCandidate } from '../../businessbrain/domain/validation';
import { deterministicImport } from '../../businessbrain/pipeline/import-fixture';
import { constructEvidence } from '../../businessbrain/pipeline/evidence-construction';
import { deterministicDiagnosis } from '../../businessbrain/pipeline/diagnosis-fixture';
import { isCoherentSnapshot } from '../../businessbrain/read/public-mappers';
import type { PublicCurrentVersion, VersionBundle } from '../../businessbrain/domain/model';

const FOUNDER = 'founder-A';

function makeService(): { svc: RefreshCoordinationService; store: BusinessBrainStore } {
  const store = new BusinessBrainStore();
  const svc = new RefreshCoordinationService(store, new MockClock());
  return { svc, store };
}

/** Build a valid bundle directly (for validator unit tests). */
function validBundle(versionId = 'V1'): VersionBundle {
  const evidence = constructEvidence(versionId, FOUNDER, deterministicImport('sufficient')).evidence!;
  return { versionId, founderId: FOUNDER, evidence, diagnosis: deterministicDiagnosis(versionId, evidence) };
}

function asCurrent(v: PublicCurrentVersion | { state: 'no_current_version' }): PublicCurrentVersion {
  if ('state' in v) throw new Error('expected a Current Version');
  return v;
}

describe('Business Brain V1 — core lifecycle', () => {
  let svc: RefreshCoordinationService;
  let store: BusinessBrainStore;
  beforeEach(() => {
    ({ svc, store } = makeService());
  });

  it('1. a new Founder has no Current Version', () => {
    expect(svc.getCurrent(FOUNDER)).toEqual({ state: 'no_current_version' });
  });

  it('2. Start Refresh creates exactly one internal Candidate + refresh_reference', () => {
    const snap = svc.startRefresh(FOUNDER);
    expect(snap.refreshState).toBe('in_progress');
    expect(snap.refreshReference).toBeTruthy();
    expect(svc.activeCandidateVersionId(FOUNDER)).toBeTruthy();
  });

  it('3. a second Start Refresh cannot create another Candidate', () => {
    svc.startRefresh(FOUNDER);
    const first = svc.activeCandidateVersionId(FOUNDER);
    let code: string | undefined;
    try {
      svc.startRefresh(FOUNDER);
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('REFRESH_ALREADY_IN_PROGRESS');
    expect(svc.activeCandidateVersionId(FOUNDER)).toBe(first);
  });

  it('4. Candidate is never returned by the public Current query', () => {
    svc.startRefresh(FOUNDER);
    expect(svc.getCurrent(FOUNDER)).toEqual({ state: 'no_current_version' });
  });

  it('5. the Import fixture produces persisted Evidence facts', () => {
    const result = constructEvidence('V1', FOUNDER, deterministicImport('sufficient'));
    expect(result.sufficient).toBe(true);
    expect(result.evidence!.items.length).toBeGreaterThanOrEqual(3);
  });

  it('6. the Diagnosis fixture produces the complete Candidate structure', () => {
    svc.startRefresh(FOUNDER);
    svc.runToCompletion(FOUNDER);
    const cur = asCurrent(svc.getCurrent(FOUNDER));
    expect(cur.businessReality).toBeTruthy();
    expect(cur.businessConsequences.length).toBeGreaterThanOrEqual(1);
    expect(cur.evidence.claims.length).toBeGreaterThanOrEqual(1);
    expect(cur.cannotYetKnow).toBeTruthy();
    expect(cur.rootCauses.length).toBeGreaterThanOrEqual(1);
    expect(cur.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(cur.executionPlan.length).toBeGreaterThanOrEqual(1);
    expect(cur.executionPlan[0]!.actions.length).toBeGreaterThanOrEqual(1);
  });

  it('7. Validation rejects a missing Cannot Yet Know', () => {
    const b = validBundle();
    const broken: VersionBundle = { ...b, diagnosis: { ...b.diagnosis, cannotYetKnow: '' } };
    const r = validateCandidate(broken);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('missing_cannot_yet_know');
  });

  it('8. Validation rejects metrics outside Evidence', () => {
    const b = validBundle();
    const broken: VersionBundle = {
      ...b,
      diagnosis: { ...b.diagnosis, businessReality: 'You read as 87 percent personal.' },
    };
    const r = validateCandidate(broken);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('metric_in_business_reality');
  });

  it('9. Validation rejects incomplete traceability (Root Cause without Evidence)', () => {
    const b = validBundle();
    const rc0 = b.diagnosis.rootCauses[0]!;
    const broken: VersionBundle = {
      ...b,
      diagnosis: { ...b.diagnosis, rootCauses: [{ ...rc0, evidenceItemIds: [] }] },
    };
    const r = validateCandidate(broken);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('root_cause_without_evidence');
  });

  it('10. Validation rejects cross-Version links (dangling Evidence reference)', () => {
    const b = validBundle();
    const rc0 = b.diagnosis.rootCauses[0]!;
    const broken: VersionBundle = {
      ...b,
      diagnosis: { ...b.diagnosis, rootCauses: [{ ...rc0, evidenceItemIds: ['OTHER-VERSION-ei-0'] }] },
    };
    const r = validateCandidate(broken);
    expect(r.valid).toBe(false);
    expect(r.failures).toContain('root_cause_dangling_evidence');
  });

  it('11. Promotion creates exactly one Current Version', () => {
    svc.startRefresh(FOUNDER);
    const snap = svc.runToCompletion(FOUNDER);
    expect(snap.refreshState).toBe('completed');
    const cur = asCurrent(svc.getCurrent(FOUNDER));
    expect(cur.versionId).toBe(store.getCurrent(FOUNDER)!.versionId);
  });

  it('12. Promotion replaces the prior Current atomically', () => {
    svc.startRefresh(FOUNDER);
    svc.runToCompletion(FOUNDER);
    const v1 = asCurrent(svc.getCurrent(FOUNDER)).versionId;
    svc.startRefresh(FOUNDER);
    svc.runToCompletion(FOUNDER);
    const v2 = asCurrent(svc.getCurrent(FOUNDER)).versionId;
    expect(v2).not.toBe(v1);
    expect(store.getCurrent(FOUNDER)!.versionId).toBe(v2); // exactly one Current, the new one
  });

  it('13. a failed Promotion leaves the prior Current intact', () => {
    svc.startRefresh(FOUNDER);
    svc.runToCompletion(FOUNDER);
    const v1 = asCurrent(svc.getCurrent(FOUNDER)).versionId;
    store.failNextPromotion = true;
    svc.startRefresh(FOUNDER);
    const snap = svc.runToCompletion(FOUNDER);
    expect(snap.refreshState).toBe('failed');
    expect(asCurrent(svc.getCurrent(FOUNDER)).versionId).toBe(v1); // unchanged
  });

  it('14. a failed Validation discards the Candidate and leaves Current unchanged', () => {
    svc.startRefresh(FOUNDER);
    svc.runToCompletion(FOUNDER);
    const v1 = asCurrent(svc.getCurrent(FOUNDER)).versionId;
    svc.startRefresh(FOUNDER, { flaw: 'omit_cannot_yet_know' });
    const snap = svc.runToCompletion(FOUNDER);
    expect(snap.refreshState).toBe('failed');
    expect(snap.failureCategory).toBe('diagnosis_unavailable');
    expect(svc.activeCandidateVersionId(FOUNDER)).toBeNull(); // discarded
    expect(asCurrent(svc.getCurrent(FOUNDER)).versionId).toBe(v1); // unchanged
  });

  it('15. Get Current returns one coherent Version identified only by Version ID', () => {
    svc.startRefresh(FOUNDER);
    svc.runToCompletion(FOUNDER);
    const cur = asCurrent(svc.getCurrent(FOUNDER));
    expect(typeof cur.versionId).toBe('string');
    expect(cur.producedAt).toBeTruthy();
  });

  it('16. Refresh Progress never exposes an impossible combination', () => {
    const s0 = svc.getRefreshProgress(FOUNDER);
    expect(isCoherentSnapshot(s0)).toBe(true); // none
    const s1 = svc.startRefresh(FOUNDER);
    expect(isCoherentSnapshot(s1)).toBe(true); // in_progress|running|none|none
    const s2 = svc.runToCompletion(FOUNDER);
    expect(isCoherentSnapshot(s2)).toBe(true); // completed|sufficient|produced|passed
    // Insufficient path
    const other = 'founder-B';
    svc.startRefresh(other, { importMode: 'insufficient' });
    const s3 = svc.runToCompletion(other);
    expect(isCoherentSnapshot(s3)).toBe(true);
    expect(s3.refreshState).toBe('failed');
    expect(s3.failureCategory).toBe('insufficient_evidence');
  });

  it('17. a stale completion after Candidate Discard writes nothing', () => {
    svc.startRefresh(FOUNDER);
    const staleId = svc.activeCandidateVersionId(FOUNDER)!;
    svc.cancelRefresh(FOUNDER);
    const wrote = svc.tryCommitStaleDiagnosis(FOUNDER, staleId);
    expect(wrote).toBe(false);
    expect(svc.getCurrent(FOUNDER)).toEqual({ state: 'no_current_version' });
    expect(svc.activeCandidateVersionId(FOUNDER)).toBeNull();
  });

  it('18. no public response contains persistence identifiers', () => {
    svc.startRefresh(FOUNDER);
    svc.runToCompletion(FOUNDER);
    const cur = asCurrent(svc.getCurrent(FOUNDER));
    const json = JSON.stringify(cur);
    // internal id shapes: `${versionId}-ei-`, `-rc-`, `-rec-`, `-a-`, `-ev`
    for (const marker of ['-ei-', '-rc-', '-rec-', '-a-', '-ev']) {
      expect(json.includes(marker)).toBe(false);
    }
    for (const key of ['evidenceItemId', 'rootCauseId', 'recommendationId', 'actionId', 'evidenceVersionId']) {
      expect(json.includes(key)).toBe(false);
    }
    // Refresh snapshot also carries no internal ids.
    const snapJson = JSON.stringify(svc.getRefreshProgress(FOUNDER));
    expect(snapJson.includes('candidateVersionId')).toBe(false);
  });
});
