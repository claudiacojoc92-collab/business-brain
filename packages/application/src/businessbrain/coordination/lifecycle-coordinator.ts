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

      // 7–9. ONE LLM call, with a BOUNDED RETRY. The narrative must pass BOTH the grounding gate and
      // business-grammar/traceability validation. All three failure modes are non-deterministic LLM slips
      // (an occasional digit or channel word in a narrative field; a cited evidence key or index that
      // doesn't resolve). Rather than fail the whole refresh on the first imperfect draft, regenerate up
      // to MAX_DIAGNOSIS_ATTEMPTS and only persist a narrative that ALREADY validates. Every rejected
      // attempt is logged with its exact reason, so a systematic (non-transient) failure is visible.
      const MAX_DIAGNOSIS_ATTEMPTS = 3;
      let result: Awaited<ReturnType<DiagnosisModelPort['generate']>> | undefined;
      let diagnosis: ReturnType<typeof composeDiagnosisContent> | undefined;
      for (let attempt = 1; attempt <= MAX_DIAGNOSIS_ATTEMPTS; attempt += 1) {
        let draft: Awaited<ReturnType<DiagnosisModelPort['generate']>>;
        try {
          draft = await this.diagnosisPort.generate(ctx);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[bb-pipeline] generate threw attempt=%d/%d founder=%s version=%s err=%s', attempt, MAX_DIAGNOSIS_ATTEMPTS, founderId, versionId, e instanceof Error ? e.stack ?? e.message : String(e));
          continue;
        }
        const grounding = checkGrounding(draft.narrative, ctx);
        if (!grounding.ok) {
          // eslint-disable-next-line no-console
          console.error('[bb-pipeline] grounding rejected attempt=%d/%d founder=%s version=%s detail=%j', attempt, MAX_DIAGNOSIS_ATTEMPTS, founderId, versionId, grounding);
          continue;
        }
        const draftDiagnosis = composeDiagnosisContent(versionId, draft.narrative, built.evidence, built.claims);
        const check = validateCandidate({ versionId, founderId, evidence: built.evidence, diagnosis: draftDiagnosis });
        if (!check.valid) {
          // eslint-disable-next-line no-console
          console.error('[bb-pipeline] validation failed attempt=%d/%d founder=%s version=%s failures=%j', attempt, MAX_DIAGNOSIS_ATTEMPTS, founderId, versionId, check.failures);
          continue;
        }
        // eslint-disable-next-line no-console
        console.log('[bb-pipeline] diagnosis valid on attempt=%d/%d founder=%s version=%s', attempt, MAX_DIAGNOSIS_ATTEMPTS, founderId, versionId);
        result = draft;
        diagnosis = draftDiagnosis;
        break;
      }
      if (!result || !diagnosis) {
        // eslint-disable-next-line no-console
        console.error('[bb-pipeline] diagnosis exhausted all %d attempts founder=%s version=%s', MAX_DIAGNOSIS_ATTEMPTS, founderId, versionId);
        await this.repo.failAndDiscard(founderId, versionId, genFail, { importState: 'sufficient', diagnosisState: 'generation_failed' }, at());
        return;
      }

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
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[bb-pipeline] diagnosis persist failed founder=%s version=%s err=%s', founderId, versionId, e instanceof Error ? e.stack ?? e.message : String(e));
        await this.repo.failAndDiscard(founderId, versionId, genFail, { importState: 'sufficient', diagnosisState: 'generation_failed' }, at());
        return;
      }
      if (!diagOk) return; // stale

      // 11. Validate (business grammar + traceability) → promote. Already validated above; this is the
      // authoritative persisted-state gate. A failure here means a repository mapping problem, not the LLM.
      const validation = validateCandidate({ versionId, founderId, evidence: built.evidence, diagnosis });
      if (!validation.valid) {
        // eslint-disable-next-line no-console
        console.error('[bb-pipeline] post-persist validation failed founder=%s version=%s failures=%j', founderId, versionId, validation.failures);
        await this.repo.commitValidationFailedAndDiscard(founderId, versionId, at());
        return;
      }
      await this.repo.commitValidationPassed(founderId, versionId, at());
      await this.repo.promoteCandidateAtomically(founderId, versionId, at());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[bb-pipeline] pipeline threw founder=%s version=%s err=%s', founderId, versionId, e instanceof Error ? e.stack ?? e.message : String(e));
      const category: FailureCategory = 'temporary_failure';
      try {
        await this.repo.failAndDiscard(founderId, versionId, category, {}, at());
      } catch {
        /* best-effort; never rethrow from the detached task */
      }
    }
  }
}
