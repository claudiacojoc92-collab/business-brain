/**
 * Wave 3 — market context service. addEntity, reviewEntity (RETRIEVE a known entity's public site via the
 * injected adapter → store per-page OBSERVED findings and a SEPARATE bounded inference finding → founder
 * reviews), recordFindingResponse (TWO independent judgments — source accuracy + business relevance — never
 * collapsed), finding views (finding + effective response + prior-response flag), and the orchestration-
 * boundary projection. Frozen engine untouched. No discovery.
 */
import type { PgMarketEntityRepository, PgMarketFindingRepository } from './pg-market.repository';
import type { PgMarketFindingResponseRepository } from './pg-market-finding-response.repository';
import type { PgMarketReviewRepository } from './pg-market-review.repository';
import { capMarketEpistemics, classifyFindingUsability, type AccuracyStatus, type FindingResponseRecord, type MarketFinding, type MarketInferenceModel, type RelevanceResponseStatus, type ResearchAdapter, type RetrievalResult } from './market-context';

export async function reviewEntity(args: {
  founderId: string; entityId: string;
  entities: PgMarketEntityRepository; findings: PgMarketFindingRepository;
  adapter: ResearchAdapter; inferenceModel: MarketInferenceModel; founderBusiness: string; now: Date;
}): Promise<
  | { status: 'ok'; retrieval: RetrievalResult; findings: MarketFinding[] }
  | { status: 'not_found' } | { status: 'no_website' } | { status: 'insufficient'; retrieval: RetrievalResult }
> {
  const entity = await args.entities.get(args.founderId, args.entityId);
  if (!entity) return { status: 'not_found' };
  if (!entity.websiteUrl) return { status: 'no_website' };

  const retrieval = await args.adapter.retrieve(entity.websiteUrl);
  if (retrieval.pages.length === 0) return { status: 'insufficient', retrieval }; // robots/unreachable/sparse → honest not-yet

  const nowIso = args.now.toISOString();
  const out: MarketFinding[] = [];
  // OBSERVED — one finding per public page (what the source presents), full provenance, inference separate.
  for (const p of retrieval.pages) {
    out.push(await args.findings.append({
      founderId: args.founderId, marketEntityId: args.entityId, reviewId: null, sourceUrl: p.url, canonicalUrl: p.canonicalUrl,
      sourceTitle: p.title, sourceType: p.sourceType, retrievedAt: nowIso, retrievalAdapter: args.adapter.name,
      extractionVersion: args.adapter.extractionVersion, observedText: p.text.slice(0, 4000), evidenceFragmentId: null,
      inferenceText: null, epistemicStatus: 'OBSERVED', relevanceToFounder: null, founderResponse: 'unreviewed',
      founderQualification: null, modelVersion: null, promptVersion: null, supersedesId: null,
    }, args.now));
  }
  // INFERENCE — one bounded reading, SEPARATE from observation; capped so it never asserts market fact.
  const inf = await args.inferenceModel.infer({ entityName: entity.name, entityType: entity.entityType, observed: retrieval.pages, founderBusiness: args.founderBusiness });
  out.push(await args.findings.append({
    founderId: args.founderId, marketEntityId: args.entityId, reviewId: null, sourceUrl: entity.websiteUrl, canonicalUrl: null,
    sourceTitle: entity.name, sourceType: 'inference', retrievedAt: nowIso, retrievalAdapter: args.adapter.name,
    extractionVersion: args.adapter.extractionVersion, observedText: `(reading across ${retrieval.pages.length} public page(s))`,
    evidenceFragmentId: null, inferenceText: inf.inferenceText, epistemicStatus: capMarketEpistemics(inf.epistemicStatus, inf.inferenceText),
    relevanceToFounder: inf.relevanceToFounder, founderResponse: 'unreviewed', founderQualification: null,
    modelVersion: args.inferenceModel.modelId ?? args.inferenceModel.version, promptVersion: args.inferenceModel.promptVersion ?? null, supersedesId: null,
  }, args.now));
  return { status: 'ok', retrieval, findings: out };
}

/** Record a founder response — two INDEPENDENT dimensions (accuracy + relevance), append-only with
 *  supersession. Returns null when the finding isn't the founder's (isolation). The finding is never mutated. */
export async function recordFindingResponse(args: {
  founderId: string; findingId: string;
  accuratelyReflectsSource: AccuracyStatus; relevanceStatus: RelevanceResponseStatus;
  accuracyQualification: string | null; relevanceQualification: string | null;
  findings: PgMarketFindingRepository; responses: PgMarketFindingResponseRepository; now: Date;
}): Promise<FindingResponseRecord | null> {
  const owned = await args.findings.getById(args.founderId, args.findingId);
  if (!owned) return null; // not found / not the founder's — never leak another founder's finding
  return args.responses.record({
    founderId: args.founderId, marketFindingId: args.findingId,
    accuratelyReflectsSource: args.accuratelyReflectsSource, relevanceStatus: args.relevanceStatus,
    accuracyQualification: args.accuracyQualification, relevanceQualification: args.relevanceQualification, now: args.now,
  });
}

export interface FindingView extends MarketFinding {
  effectiveResponse: FindingResponseRecord | null;
  hasPriorResponses: boolean; // any response history exists for this finding (i.e. it was reviewed / revised)
}

/** Findings for one entity, each with its latest effective response + a prior-response flag. Observation and
 *  inference stay SEPARATE rows (the caller renders them distinctly). The finding text is never rewritten. */
export async function findingViewsForEntity(founderId: string, entityId: string, findings: PgMarketFindingRepository, responses: PgMarketFindingResponseRepository): Promise<FindingView[]> {
  const rows = await findings.listByEntity(founderId, entityId);
  const eff = await responses.effectiveByFounder(founderId);
  const withHistory = await responses.findingsWithHistory(founderId);
  return rows.map((f) => ({ ...f, effectiveResponse: eff.get(f.id) ?? null, hasPriorResponses: withHistory.has(f.id) }));
}

/**
 * Orchestration boundary — the effective usable market context, with everything kept DISTINCT and each
 * finding's accuracy + relevance kept independent. A finding is exposed as ordinary usable context only when:
 *   - it belongs to a CONFIRMED (eligible) entity;
 *   - it is from the entity's LATEST successful (READY) review;
 *   - its effective response has relevance relevant/partly_relevant AND accuracy is not 'no'.
 * Unreviewed findings (from the latest review, eligible entity) are exposed SEPARATELY as provisional context.
 * Excluded entirely: inaccurate (accuracy 'no'), not-relevant, superseded/stale (not the latest review),
 * failed-review, and unconfirmed suggested entities. Qualifications travel with the finding.
 */
export async function effectiveMarketContext(founderId: string, entities: PgMarketEntityRepository, findings: PgMarketFindingRepository, responses: PgMarketFindingResponseRepository, reviews: PgMarketReviewRepository): Promise<{
  confirmedEntities: Array<{ id: string; name: string; entityType: string; websiteUrl: string | null }>;
  suggestedUnconfirmed: Array<{ id: string; name: string; entityType: string }>;
  observed: Array<{ id: string; entityId: string; sourceUrl: string; observedText: string; accuracy: AccuracyStatus; relevance: RelevanceResponseStatus; accuracyQualification: string | null; relevanceQualification: string | null }>;
  inferences: Array<{ id: string; entityId: string; inferenceText: string; epistemicStatus: string; accuracy: AccuracyStatus; relevance: RelevanceResponseStatus; accuracyQualification: string | null; relevanceQualification: string | null }>;
  provisional: {
    observed: Array<{ id: string; entityId: string; sourceUrl: string; observedText: string }>;
    inferences: Array<{ id: string; entityId: string; inferenceText: string; epistemicStatus: string }>;
  };
}> {
  const ents = await entities.list(founderId);
  const eligible = new Set(ents.filter((e) => e.relevanceStatus === 'confirmed').map((e) => e.id));
  const all = await findings.listByFounder(founderId);
  const eff = await responses.effectiveByFounder(founderId);
  const latestReady = await reviews.latestReadyByEntity(founderId);

  // Current = eligible entity + from the entity's latest READY review. Findings from a direct (non-durable,
  // reviewId=null) path are current only when the entity has no READY review at all.
  const isCurrent = (f: MarketFinding): boolean => {
    if (!eligible.has(f.marketEntityId)) return false;
    const latest = latestReady.get(f.marketEntityId);
    return latest ? f.reviewId === latest : f.reviewId === null;
  };
  const current = all.filter(isCurrent);

  const usable = current.filter((f) => classifyFindingUsability(eff.get(f.id) ?? null) === 'usable');
  const provisional = current.filter((f) => classifyFindingUsability(eff.get(f.id) ?? null) === 'provisional');
  const dim = (f: MarketFinding) => { const r = eff.get(f.id); return { accuracy: (r?.accuratelyReflectsSource ?? 'unreviewed'), relevance: (r?.relevanceStatus ?? 'unreviewed'), accuracyQualification: r?.accuracyQualification ?? null, relevanceQualification: r?.relevanceQualification ?? null }; };

  return {
    confirmedEntities: ents.filter((e) => e.relevanceStatus === 'confirmed').map((e) => ({ id: e.id, name: e.name, entityType: e.entityType, websiteUrl: e.websiteUrl })),
    suggestedUnconfirmed: ents.filter((e) => e.origin === 'bb_suggested' && e.relevanceStatus !== 'confirmed' && e.relevanceStatus !== 'dismissed').map((e) => ({ id: e.id, name: e.name, entityType: e.entityType })),
    observed: usable.filter((f) => f.inferenceText === null).map((f) => ({ id: f.id, entityId: f.marketEntityId, sourceUrl: f.sourceUrl, observedText: f.observedText, ...dim(f) })),
    inferences: usable.filter((f) => f.inferenceText !== null).map((f) => ({ id: f.id, entityId: f.marketEntityId, inferenceText: f.inferenceText!, epistemicStatus: f.epistemicStatus, ...dim(f) })),
    provisional: {
      observed: provisional.filter((f) => f.inferenceText === null).map((f) => ({ id: f.id, entityId: f.marketEntityId, sourceUrl: f.sourceUrl, observedText: f.observedText })),
      inferences: provisional.filter((f) => f.inferenceText !== null).map((f) => ({ id: f.id, entityId: f.marketEntityId, inferenceText: f.inferenceText!, epistemicStatus: f.epistemicStatus })),
    },
  };
}
