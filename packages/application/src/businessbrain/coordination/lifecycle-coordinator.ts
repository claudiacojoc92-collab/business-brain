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
import type { BusinessBrainRepository, DevConnectionStatus, ObservationInput } from './repository';
import { validateCandidate } from '../domain/validation';
import type { DiagnosisModelPort, InstagramImportPort } from '../ports';
import type { ImportedAccount, ObservationRecord } from '../provenance/model';
import { computePostSignals } from '../provenance/signals';
import { computeAccountMetrics } from '../provenance/metrics';
import { buildDeterministicEvidence } from '../provenance/evidence';
import { assembleGenerationContext, hashGenerationContext } from '../provenance/generation-context';
import { checkGrounding } from '../provenance/grounding';
import { composeDiagnosisContent } from '../provenance/compose-diagnosis';

/** Most-recent-N posts imported and persisted per refresh (all available if fewer). */
export const MAX_IMPORT_POSTS = 100;

export interface StartRefreshOptions {
  readonly idempotencyToken?: string;
  /**
   * Dev-only idempotency-fingerprint discriminators (do NOT drive any fixture — the pipeline is real).
   * Kept so a reused token with different declared semantics still raises IDEMPOTENCY_CONFLICT.
   */
  readonly importMode?: 'sufficient' | 'insufficient';
  readonly flaw?: string;
}

/** Stable, content-free fingerprint of the request semantics for idempotency conflict detection. */
function fingerprint(opts: StartRefreshOptions): string {
  return `${opts.importMode ?? 'default'}:${opts.flaw ?? 'none'}`;
}

export class BusinessBrainCoordinator {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: BusinessBrainRepository,
    private readonly clock: IClock,
    /** Real Instagram import (adapter loads the credential + calls Graph). */
    private readonly importPort: InstagramImportPort,
    /** The single-call account diagnosis model (real Anthropic in production). */
    private readonly diagnosisPort: DiagnosisModelPort,
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

  /** Reflects the real Instagram connection (presence of an encrypted OAuth credential). */
  getConnectionStatus(founderId: string): Promise<DevConnectionStatus> {
    return this.repo.getConnectionStatus(founderId);
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

  private async runPipeline(founderId: string, versionId: string, _opts: StartRefreshOptions): Promise<void> {
    const at = (): string => this.clock.nowISO();
    const genFail = 'diagnosis_unavailable' as const;
    try {
      // 1. REAL import — the adapter loads the encrypted credential and calls the Graph API.
      let imported: ImportedAccount;
      try {
        imported = await this.importPort.importAccount(founderId, { maxPosts: MAX_IMPORT_POSTS });
      } catch {
        await this.repo.commitImportFailureAndDiscard(founderId, versionId, 'failed', 'import_temporarily_unavailable', at());
        return;
      }

      // 2. Deterministic signals → observation records.
      const observations: ObservationRecord[] = imported.posts.map((p) => ({
        observationId: generateId(),
        ...p,
        ...computePostSignals(p.caption),
      }));

      // 3. Deterministic account metrics (every number is a real computation over the observations).
      const metrics = computeAccountMetrics(observations, imported.followersCount);

      // 4. Deterministic evidence + sufficiency gate.
      const built = buildDeterministicEvidence(versionId, founderId, metrics, observations);
      if (!built.sufficient || !built.evidence || !built.claims) {
        await this.repo.commitImportFailureAndDiscard(founderId, versionId, 'insufficient', 'insufficient_evidence', at());
        return;
      }

      // 5. Persist the provenance store (import + observations) + evidence in ONE transaction.
      const importId = generateId();
      const observationInputs: ObservationInput[] = observations.map((o) => ({
        observationId: o.observationId, postExternalId: o.postExternalId, permalink: o.permalink,
        mediaType: o.mediaType, postedAt: o.postedAt, reach: o.reach, likes: o.likes, comments: o.comments,
        caption: o.caption, captionLength: o.captionLength, wordCount: o.wordCount, hashtagCount: o.hashtagCount,
        mentionCount: o.mentionCount, hasLink: o.hasLink, hasCta: o.hasCta,
      }));
      const importOk = await this.repo.commitImportSufficient({
        founderId, versionId, evidence: built.evidence, importJobId: generateId(), at: at(),
        ...(metrics.windowFrom && metrics.windowTo ? { windowDescriptor: `${metrics.windowFrom}..${metrics.windowTo}` } : {}),
        import: {
          importId, source: 'instagram',
          accountExternalId: imported.accountExternalId, accountUsername: imported.username, accountType: imported.accountType,
          followersCount: imported.followersCount, mediaCount: imported.mediaCount,
          importedPostCount: observations.length, windowFrom: metrics.windowFrom, windowTo: metrics.windowTo,
          importedAt: imported.importedAt,
        },
        observations: observationInputs,
      });
      if (!importOk) return; // stale — candidate cancelled/discarded

      // 6. One structured context — the model's entire input.
      const ctx = assembleGenerationContext(imported, metrics, observations, built.evidence.items);

      // 7. ONE LLM call for the whole account.
      let result;
      try {
        result = await this.diagnosisPort.generate(ctx);
      } catch {
        await this.repo.failAndDiscard(founderId, versionId, genFail, { importState: 'sufficient', diagnosisState: 'generation_failed' }, at());
        return;
      }

      // 8. Grounding gate — reject fabricated numbers / dangling links before anything is shown.
      if (!checkGrounding(result.narrative, ctx).ok) {
        await this.repo.failAndDiscard(founderId, versionId, genFail, { importState: 'sufficient', diagnosisState: 'generation_failed' }, at());
        return;
      }

      // 9. Compose DiagnosisContent: deterministic evidence + business-language narrative + traceability.
      const diagnosis = composeDiagnosisContent(versionId, result.narrative, built.evidence, built.claims);

      // 10. Persist diagnosis + freeze the exact model input (context + SHA-256).
      let diagOk = false;
      try {
        diagOk = await this.repo.commitCandidateDiagnosis({
          founderId, versionId, diagnosis, diagnosisJobId: generateId(), at: at(),
          generationContext: {
            generationContextId: generateId(), context: ctx, contentHash: hashGenerationContext(ctx),
            modelId: result.modelId, promptTemplateHash: result.promptTemplateHash,
          },
        });
      } catch {
        await this.repo.failAndDiscard(founderId, versionId, genFail, { importState: 'sufficient', diagnosisState: 'generation_failed' }, at());
        return;
      }
      if (!diagOk) return; // stale

      // 11. Validate (business grammar + traceability) → promote.
      const validation = validateCandidate({ versionId, founderId, evidence: built.evidence, diagnosis });
      if (!validation.valid) {
        await this.repo.commitValidationFailedAndDiscard(founderId, versionId, at());
        return;
      }
      await this.repo.commitValidationPassed(founderId, versionId, at());
      await this.repo.promoteCandidateAtomically(founderId, versionId, at());
    } catch {
      const category: FailureCategory = 'temporary_failure';
      try {
        await this.repo.failAndDiscard(founderId, versionId, category, {}, at());
      } catch {
        /* best-effort; never rethrow from the detached task */
      }
    }
  }
}
