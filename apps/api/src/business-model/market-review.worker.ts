/**
 * Wave 3 — durable market-review worker. Processes a CLAIMED review (already RETRIEVING) stage-by-stage,
 * renewing the lease, failing CLOSED with a precise category. Retrieval + inference run OUTSIDE the final
 * transaction; findings + READY commit atomically in one transaction (crash-before-commit publishes nothing;
 * after-commit is idempotent — READY is terminal, no re-claim, no duplicates).
 */
import type { PgMarketReviewRepository } from './pg-market-review.repository';
import type { PgMarketEntityRepository, PgMarketFindingRepository } from './pg-market.repository';
import { classifyRetrieval, capMarketEpistemics, type MarketInferenceModel, type ResearchAdapter } from './market-context';
import { FAILURE_MESSAGE, type MarketReview } from './market-review';

export interface MarketWorkerDeps {
  reviewRepo: PgMarketReviewRepository; entities: PgMarketEntityRepository; findings: PgMarketFindingRepository;
  adapter: ResearchAdapter; inferenceModel: MarketInferenceModel; founderBusiness: (founderId: string) => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any; leaseMs: number; now: () => Date;
}

export async function processReview(review: MarketReview, deps: MarketWorkerDeps): Promise<MarketReview> {
  const { reviewRepo, entities, findings, adapter, inferenceModel, db, leaseMs, now } = deps;
  const failed = async (cat: Parameters<PgMarketReviewRepository['markFailed']>[1], detail: string) =>
    (await reviewRepo.markFailed(review.id, cat, FAILURE_MESSAGE[cat], detail, now())) ?? (await reviewRepo.getById(review.founderId, review.id))!;
  try {
    const entity = await entities.get(review.founderId, review.marketEntityId);
    if (!entity?.websiteUrl) return await failed('UNREACHABLE', 'no website on entity');

    // RETRIEVING — fetch permitted public pages (throw → RETRIEVAL_FAILED).
    let retrieval;
    try { retrieval = await adapter.retrieve(entity.websiteUrl); }
    catch (e) { return await failed('RETRIEVAL_FAILED', String((e as Error)?.message ?? e)); }
    const category = classifyRetrieval(retrieval);
    if (category) {
      if (category === 'INSUFFICIENT_READABLE_EVIDENCE') return (await reviewRepo.markInsufficient(review.id, category, FAILURE_MESSAGE[category], now())) ?? (await reviewRepo.getById(review.founderId, review.id))!;
      return await failed(category, `retrieval empty: ${category}`);
    }
    if (!(await reviewRepo.advance(review.id, 'RETRIEVING', 'EXTRACTING', now(), leaseMs))) return (await reviewRepo.getById(review.founderId, review.id))!;

    // EXTRACTING — observations are the normalized page texts (extraction happened in the adapter).
    if (!(await reviewRepo.advance(review.id, 'EXTRACTING', 'INFERRING', now(), leaseMs))) return (await reviewRepo.getById(review.founderId, review.id))!;

    // INFERRING — the LLM reading, OUTSIDE any transaction.
    let inf;
    try { inf = await inferenceModel.infer({ entityName: entity.name, entityType: entity.entityType, observed: retrieval.pages, founderBusiness: await deps.founderBusiness(review.founderId) }); }
    catch (e) { return await failed('INFERENCE_FAILED', String((e as Error)?.message ?? e)); }
    const infStatus = capMarketEpistemics(inf.epistemicStatus, inf.inferenceText);

    // ATOMIC — all findings + READY in ONE transaction. Rollback (nothing published) if the READY race is lost.
    const nowIso = now().toISOString();
    try {
      await db.transaction().execute(async (tx: unknown) => {
        for (const p of retrieval!.pages) {
          await findings.append({ founderId: review.founderId, marketEntityId: review.marketEntityId, reviewId: review.id, sourceUrl: p.url, canonicalUrl: p.canonicalUrl, sourceTitle: p.title, sourceType: p.sourceType, retrievedAt: nowIso, retrievalAdapter: adapter.name, extractionVersion: adapter.extractionVersion, observedText: p.text.slice(0, 4000), evidenceFragmentId: null, inferenceText: null, epistemicStatus: 'OBSERVED', relevanceToFounder: null, founderResponse: 'unreviewed', founderQualification: null, supersedesId: null }, now(), tx);
        }
        await findings.append({ founderId: review.founderId, marketEntityId: review.marketEntityId, reviewId: review.id, sourceUrl: entity.websiteUrl!, canonicalUrl: null, sourceTitle: entity.name, sourceType: 'inference', retrievedAt: nowIso, retrievalAdapter: adapter.name, extractionVersion: inferenceModel.version, observedText: `(reading across ${retrieval!.pages.length} public page(s))`, evidenceFragmentId: null, inferenceText: inf.inferenceText, epistemicStatus: infStatus, relevanceToFounder: inf.relevanceToFounder, founderResponse: 'unreviewed', founderQualification: null, supersedesId: null }, now(), tx);
        const ready = await reviewRepo.markReady(review.id, now(), tx);
        if (!ready) throw new Error('review left INFERRING (lost race) — roll back');
      });
    } catch (e) { return await failed('INFERENCE_FAILED', String((e as Error)?.message ?? e)); }
    return (await reviewRepo.getById(review.founderId, review.id))!;
  } catch (e) {
    return await failed('RETRIEVAL_FAILED', String((e as Error)?.message ?? e));
  }
}

export function startMarketReviewWorker(deps: MarketWorkerDeps & { intervalMs?: number }): () => void {
  let stopped = false; const interval = deps.intervalMs ?? 1500;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await deps.reviewRepo.recoverStale(deps.now());
      const claimed = await deps.reviewRepo.claimQueued(deps.now(), deps.leaseMs);
      if (claimed) { await processReview(claimed, deps); if (!stopped) { setTimeout(() => void tick(), 0); return; } }
    } catch { /* transient */ }
    if (!stopped) setTimeout(() => void tick(), interval);
  };
  setTimeout(() => void tick(), 0);
  return () => { stopped = true; };
}
