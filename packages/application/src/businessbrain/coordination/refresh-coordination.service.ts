/**
 * Business Brain V1 — Refresh Coordination Service.
 *
 * Canonical owner of the Refresh operation and the Candidate/Version lifecycle.
 * Import and Diagnosis are producers; they never commit canonical state — this
 * service commits Import-Completion, Diagnosis-Completion, Validation, atomic
 * Promotion, and Candidate Discard. Current is untouched until Promotion.
 */
import { ApplicationError, generateId, type IClock } from '@bb/shared';

import type {
  FounderId,
  NoCurrentVersion,
  PublicCurrentVersion,
  PublicRefreshSnapshot,
  RefreshRecord,
} from '../domain/model';
import { validateCandidate } from '../domain/validation';
import { meetsPromotionCriteria } from '../domain/promotion';
import { deterministicImport, type ImportMode } from '../pipeline/import-fixture';
import { constructEvidence } from '../pipeline/evidence-construction';
import { deterministicDiagnosis, type DiagnosisFlaw } from '../pipeline/diagnosis-fixture';
import { BusinessBrainStore, PromotionFailure } from './store';
import {
  toPublicCurrentVersion,
  toPublicRefreshSnapshot,
} from '../read/public-mappers';

/** Deterministic drivers for the fixtures, injected via Start Refresh (dev/test). */
export interface RefreshPlan {
  readonly idempotencyToken?: string;
  readonly importMode?: ImportMode;
  readonly flaw?: DiagnosisFlaw;
}

interface PlanRegistryEntry {
  readonly refreshReference: string;
  readonly idempotencyToken?: string;
  readonly importMode: ImportMode;
  readonly flaw: DiagnosisFlaw;
}

export class RefreshCoordinationService {
  private readonly plans = new Map<FounderId, PlanRegistryEntry>();

  constructor(
    private readonly store: BusinessBrainStore,
    private readonly clock: IClock,
  ) {}

  // ---- Queries ----

  getCurrent(founderId: FounderId): PublicCurrentVersion | NoCurrentVersion {
    const current = this.store.getCurrent(founderId);
    return current ? toPublicCurrentVersion(current) : { state: 'no_current_version' };
  }

  getRefreshProgress(founderId: FounderId): PublicRefreshSnapshot {
    return toPublicRefreshSnapshot(this.store.getRefresh(founderId));
  }

  /** Internal (non-public) accessor for commit-time stale checks/tests. */
  activeCandidateVersionId(founderId: FounderId): string | null {
    return this.store.activeCandidateVersionId(founderId);
  }

  // ---- Commands ----

  startRefresh(founderId: FounderId, plan: RefreshPlan = {}): PublicRefreshSnapshot {
    const existing = this.store.getRefresh(founderId);
    const active = this.store.activeCandidateVersionId(founderId) !== null;
    if (active && existing) {
      // Same idempotency token -> convergent same refresh; else reject.
      const prior = this.plans.get(founderId);
      if (plan.idempotencyToken && prior?.idempotencyToken === plan.idempotencyToken) {
        return toPublicRefreshSnapshot(existing);
      }
      throw new ApplicationError(
        'REFRESH_ALREADY_IN_PROGRESS',
        'A refresh is already in progress.',
        409,
      );
    }

    const at = this.clock.nowISO();
    const versionId = generateId();
    const refreshReference = generateId();
    const record: RefreshRecord = {
      refreshReference,
      founderId,
      candidateVersionId: versionId,
      refreshState: 'in_progress',
      importState: 'running',
      diagnosisState: 'none',
      validationState: 'none',
      transitionMarker: 1,
    };
    this.store.startCandidate(founderId, record, at);
    this.plans.set(founderId, {
      refreshReference,
      ...(plan.idempotencyToken ? { idempotencyToken: plan.idempotencyToken } : {}),
      importMode: plan.importMode ?? 'sufficient',
      flaw: plan.flaw ?? 'none',
    });
    return toPublicRefreshSnapshot(record);
  }

  cancelRefresh(founderId: FounderId): PublicRefreshSnapshot {
    const active = this.store.activeCandidateVersionId(founderId) !== null;
    if (!active) {
      // Idempotent no-op: leave whatever terminal/none state exists.
      return this.getRefreshProgress(founderId);
    }
    const at = this.clock.nowISO();
    this.store.discardCandidate(founderId, at);
    const record = this.store.updateRefresh(founderId, (r) => {
      r.refreshState = 'cancelled';
      r.transitionMarker += 1;
    });
    return toPublicRefreshSnapshot(record);
  }

  /**
   * Drive the accepted refresh to a terminal outcome (import -> evidence ->
   * diagnosis -> validation -> promotion|discard). Current stays visible and
   * unchanged until atomic Promotion.
   */
  runToCompletion(founderId: FounderId): PublicRefreshSnapshot {
    const candidateVersionId = this.store.activeCandidateVersionId(founderId);
    const plan = this.plans.get(founderId);
    if (!candidateVersionId || !plan) {
      throw new ApplicationError('NO_REFRESH_IN_PROGRESS', 'No refresh in progress.', 409);
    }
    const at = () => this.clock.nowISO();

    // Import + Evidence Construction (sufficiency owned by Evidence Construction).
    const observations = deterministicImport(plan.importMode);
    const evidenceResult = constructEvidence(candidateVersionId, founderId, observations);
    if (!evidenceResult.sufficient || !evidenceResult.evidence) {
      this.store.discardCandidate(founderId, at());
      return this.terminalFailure(founderId, 'insufficient', 'insufficient_evidence');
    }
    this.store.setCandidateEvidence(founderId, candidateVersionId, evidenceResult.evidence, at());
    this.store.updateRefresh(founderId, (r) => {
      r.importState = 'sufficient';
      r.transitionMarker += 1;
    });

    // Diagnosis Generation (producer) + assembly.
    this.store.updateRefresh(founderId, (r) => {
      r.diagnosisState = 'running';
      r.transitionMarker += 1;
    });
    const diagnosis = deterministicDiagnosis(candidateVersionId, evidenceResult.evidence, plan.flaw);
    this.store.setCandidateDiagnosis(founderId, candidateVersionId, diagnosis, at());
    this.store.updateRefresh(founderId, (r) => {
      r.diagnosisState = 'produced';
      r.transitionMarker += 1;
    });

    // Validation gate.
    const validation = validateCandidate({
      versionId: candidateVersionId,
      founderId,
      evidence: evidenceResult.evidence,
      diagnosis,
    });
    this.store.updateRefresh(founderId, (r) => {
      r.validationState = validation.valid ? 'passed' : 'failed';
      r.transitionMarker += 1;
    });
    if (!validation.valid) {
      this.store.discardCandidate(founderId, at());
      return this.terminalFailure(founderId, 'sufficient', 'diagnosis_unavailable', 'produced', 'failed');
    }

    // Atomic Promotion.
    if (
      !meetsPromotionCriteria({
        importState: 'sufficient',
        diagnosisState: 'produced',
        validationState: 'passed',
      })
    ) {
      this.store.discardCandidate(founderId, at());
      return this.terminalFailure(founderId, 'sufficient', 'temporary_failure', 'produced', 'passed');
    }
    try {
      this.store.promote(founderId, candidateVersionId, at());
    } catch (err) {
      if (err instanceof PromotionFailure) {
        // Rollback: prior Current intact, Candidate retained for retry.
        const record = this.store.updateRefresh(founderId, (r) => {
          r.refreshState = 'failed';
          r.failureCategory = 'temporary_failure';
          r.transitionMarker += 1;
        });
        return toPublicRefreshSnapshot(record);
      }
      throw err;
    }
    const record = this.store.updateRefresh(founderId, (r) => {
      r.refreshState = 'completed';
      r.transitionMarker += 1;
    });
    this.plans.delete(founderId);
    return toPublicRefreshSnapshot(record);
  }

  /** Commit-time stale-worker guard proof: a stale diagnosis commit writes nothing. */
  tryCommitStaleDiagnosis(founderId: FounderId, staleVersionId: string): boolean {
    const evidence = { evidenceVersionId: `${staleVersionId}-ev`, versionId: staleVersionId, items: [] };
    const diagnosis = deterministicDiagnosis(staleVersionId, evidence, 'none');
    return this.store.setCandidateDiagnosis(founderId, staleVersionId, diagnosis, this.clock.nowISO());
  }

  private terminalFailure(
    founderId: FounderId,
    importState: RefreshRecord['importState'],
    failureCategory: NonNullable<RefreshRecord['failureCategory']>,
    diagnosisState: RefreshRecord['diagnosisState'] = 'none',
    validationState: RefreshRecord['validationState'] = 'none',
  ): PublicRefreshSnapshot {
    const record = this.store.updateRefresh(founderId, (r) => {
      r.refreshState = 'failed';
      r.importState = importState;
      r.diagnosisState = diagnosisState;
      r.validationState = validationState;
      r.failureCategory = failureCategory;
      r.transitionMarker += 1;
    });
    this.plans.delete(founderId);
    return toPublicRefreshSnapshot(record);
  }
}
