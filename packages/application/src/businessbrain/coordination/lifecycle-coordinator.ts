/**
 * Business Brain V1 — persistence-backed coordination service (application layer).
 *
 * HTTP handlers depend on THIS, never on the repository directly. It owns Refresh
 * orchestration over BusinessBrainRepository and drives the deterministic pipeline
 * (Import → Evidence → Diagnosis → Validation → Promotion|Discard). Import and
 * Diagnosis are pure producers; canonical state is committed only through repository
 * lifecycle transactions.
 *
 * Execution model (V1 dev seam): Start Refresh commits the Candidate + Refresh record
 * (accepted) and then launches the pipeline as a DETACHED in-process task that runs
 * OUTSIDE the Start Refresh transaction, catches every failure, and commits an
 * authoritative failed/terminal Refresh state. It returns accepted before Promotion.
 * `settle()` lets tests await the detached task; production would replace it with a
 * worker without changing the API contract.
 */
import { ApplicationError, generateId, type IClock } from '@bb/shared';

import type {
  FailureCategory,
  NoCurrentVersion,
  PublicCurrentVersion,
  PublicRefreshSnapshot,
} from '../domain/model';
import type { BusinessBrainRepository, DevConnectionStatus } from './repository';
import { deterministicImport } from '../pipeline/import-fixture';
import { constructEvidence } from '../pipeline/evidence-construction';
import { deterministicDiagnosis, type DiagnosisFlaw } from '../pipeline/diagnosis-fixture';
import { validateCandidate } from '../domain/validation';

export interface StartRefreshOptions {
  readonly idempotencyToken?: string;
  /** Dev-only deterministic drivers behind the fixture boundary. */
  readonly importMode?: 'sufficient' | 'insufficient';
  readonly flaw?: DiagnosisFlaw;
}

/** Stable, content-free fingerprint of the request semantics for idempotency conflict detection. */
function fingerprint(opts: StartRefreshOptions): string {
  return `${opts.importMode ?? 'sufficient'}:${opts.flaw ?? 'none'}`;
}

export class BusinessBrainCoordinator {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: BusinessBrainRepository,
    private readonly clock: IClock,
    /** 'detached' (default) returns accepted before completion; 'inline' awaits it (tests). */
    private readonly runner: 'detached' | 'inline' = 'detached',
  ) {}

  // ---- Authoritative reads ----

  async getCurrent(founderId: string): Promise<PublicCurrentVersion | NoCurrentVersion> {
    const cur = await this.repo.getCurrentAggregate(founderId);
    return cur ?? { state: 'no_current_version' };
  }

  getRefreshProgress(founderId: string): Promise<PublicRefreshSnapshot> {
    return this.repo.getRefreshProgress(founderId);
  }

  getConnectionStatus(founderId: string): Promise<DevConnectionStatus> {
    return this.repo.getConnectionStatus(founderId);
  }

  // ---- Connection (dev adapter) ----

  connect(founderId: string): Promise<DevConnectionStatus> {
    return this.repo.connect(founderId, this.clock.nowISO());
  }

  disconnect(founderId: string): Promise<DevConnectionStatus> {
    return this.repo.disconnect(founderId, this.clock.nowISO());
  }

  // ---- Commands ----

  async startRefresh(founderId: string, opts: StartRefreshOptions = {}): Promise<PublicRefreshSnapshot> {
    const conn = await this.repo.getConnectionStatus(founderId);
    if (conn.connectionState !== 'connected') {
      throw new ApplicationError('INSTAGRAM_REQUIRED', 'Connect Instagram before starting a refresh.', 409);
    }
    const res = await this.repo.startRefresh({
      founderId,
      versionId: generateId(),
      refreshReference: generateId(),
      importJobId: generateId(),
      ...(opts.idempotencyToken ? { idempotencyToken: opts.idempotencyToken } : {}),
      requestFingerprint: fingerprint(opts),
      at: this.clock.nowISO(),
    });
    if (res.kind === 'conflict') {
      throw new ApplicationError('IDEMPOTENCY_CONFLICT', 'This idempotency token was used for a different request.', 409);
    }
    if (res.kind === 'in_progress') {
      throw new ApplicationError('REFRESH_ALREADY_IN_PROGRESS', 'A refresh is already in progress.', 409);
    }
    if (res.kind === 'created') {
      await this.launchPipeline(founderId, res.candidateVersionId, opts);
    }
    return res.snapshot;
  }

  async cancelRefresh(founderId: string): Promise<PublicRefreshSnapshot> {
    await this.repo.cancelAndDiscard(founderId, this.clock.nowISO());
    return this.repo.getRefreshProgress(founderId);
  }

  /** Await the detached pipeline for a Founder (tests / graceful shutdown). */
  async settle(founderId: string): Promise<void> {
    const p = this.inflight.get(founderId);
    if (p) await p;
  }

  private async launchPipeline(founderId: string, versionId: string, opts: StartRefreshOptions): Promise<void> {
    const task = this.runPipeline(founderId, versionId, opts).catch(() => {
      /* runPipeline never rethrows; guard here prevents any unhandled rejection */
    });
    this.inflight.set(founderId, task);
    if (this.runner === 'inline') await task;
  }

  private async runPipeline(founderId: string, versionId: string, opts: StartRefreshOptions): Promise<void> {
    const at = (): string => this.clock.nowISO();
    try {
      const observations = deterministicImport(opts.importMode ?? 'sufficient');
      const ev = constructEvidence(versionId, founderId, observations);
      if (!ev.sufficient || !ev.evidence) {
        await this.repo.commitImportFailureAndDiscard(founderId, versionId, 'insufficient', 'insufficient_evidence', at());
        return;
      }
      const importOk = await this.repo.commitImportSufficient({ founderId, versionId, evidence: ev.evidence, importJobId: generateId(), at: at() });
      if (!importOk) return; // Candidate was cancelled/discarded — stale, write nothing.

      const diagnosis = deterministicDiagnosis(versionId, ev.evidence, opts.flaw ?? 'none');
      let diagOk = false;
      try {
        diagOk = await this.repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis, diagnosisJobId: generateId(), at: at() });
      } catch {
        // Diagnosis could not be persisted (e.g., structurally impossible content) — generation failure.
        await this.repo.failAndDiscard(founderId, versionId, 'diagnosis_unavailable', { importState: 'sufficient', diagnosisState: 'generation_failed' }, at());
        return;
      }
      if (!diagOk) return; // stale

      const validation = validateCandidate({ versionId, founderId, evidence: ev.evidence, diagnosis });
      if (!validation.valid) {
        await this.repo.commitValidationFailedAndDiscard(founderId, versionId, at());
        return;
      }
      await this.repo.commitValidationPassed(founderId, versionId, at());
      await this.repo.promoteCandidateAtomically(founderId, versionId, at());
      // 'stale' → the Candidate was concurrently cancelled/deleted; nothing to do.
    } catch {
      // Any unexpected failure: commit a governed, content-free terminal failed state.
      const category: FailureCategory = 'temporary_failure';
      try {
        await this.repo.failAndDiscard(founderId, versionId, category, {}, at());
      } catch {
        /* best-effort; never rethrow from the detached task */
      }
    }
  }
}
