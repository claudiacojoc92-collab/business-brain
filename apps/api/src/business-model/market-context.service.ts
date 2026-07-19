/**
 * Wave 3 — market context service. addEntity, reviewEntity (RETRIEVE a known entity's public site via the
 * injected adapter → store per-page OBSERVED findings and a SEPARATE bounded inference finding → founder
 * reviews), respondToFinding, and the orchestration-boundary projection (confirmed/observed/inference/
 * dismissed/qualified kept distinct). Frozen engine untouched. No discovery.
 */
import type { PgMarketEntityRepository, PgMarketFindingRepository } from './pg-market.repository';
import { capMarketEpistemics, type FindingResponse, type MarketFinding, type MarketInferenceModel, type ResearchAdapter, type RetrievalResult } from './market-context';

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
      founderQualification: null, supersedesId: null,
    }, args.now));
  }
  // INFERENCE — one bounded reading, SEPARATE from observation; capped so it never asserts market fact.
  const inf = await args.inferenceModel.infer({ entityName: entity.name, entityType: entity.entityType, observed: retrieval.pages, founderBusiness: args.founderBusiness });
  out.push(await args.findings.append({
    founderId: args.founderId, marketEntityId: args.entityId, reviewId: null, sourceUrl: entity.websiteUrl, canonicalUrl: null,
    sourceTitle: entity.name, sourceType: 'inference', retrievedAt: nowIso, retrievalAdapter: args.adapter.name,
    extractionVersion: args.inferenceModel.version, observedText: `(reading across ${retrieval.pages.length} public page(s))`,
    evidenceFragmentId: null, inferenceText: inf.inferenceText, epistemicStatus: capMarketEpistemics(inf.epistemicStatus, inf.inferenceText),
    relevanceToFounder: inf.relevanceToFounder, founderResponse: 'unreviewed', founderQualification: null, supersedesId: null,
  }, args.now));
  return { status: 'ok', retrieval, findings: out };
}

export async function respondToFinding(args: { founderId: string; findingId: string; response: FindingResponse; qualification: string | null; findings: PgMarketFindingRepository; now: Date }): Promise<MarketFinding | null> {
  return args.findings.respond(args.founderId, args.findingId, args.response, args.qualification, args.now);
}

/**
 * Orchestration boundary — only reviewed-or-provisional context, with everything kept DISTINCT:
 * confirmed vs suggested-unconfirmed entities; observed vs inference findings; dismissed excluded; qualified preserved.
 */
export async function effectiveMarketContext(founderId: string, entities: PgMarketEntityRepository, findings: PgMarketFindingRepository): Promise<{
  confirmedEntities: Array<{ id: string; name: string; entityType: string; websiteUrl: string | null }>;
  suggestedUnconfirmed: Array<{ id: string; name: string; entityType: string }>;
  observed: Array<{ id: string; entityId: string; sourceUrl: string; observedText: string; founderResponse: FindingResponse; qualification: string | null }>;
  inferences: Array<{ id: string; entityId: string; inferenceText: string; epistemicStatus: string; founderResponse: FindingResponse; qualification: string | null }>;
}> {
  const ents = await entities.list(founderId);
  const all = await findings.listByFounder(founderId);
  const kept = all.filter((f) => f.founderResponse !== 'dismissed'); // dismissed excluded from orchestration
  return {
    confirmedEntities: ents.filter((e) => e.relevanceStatus === 'confirmed').map((e) => ({ id: e.id, name: e.name, entityType: e.entityType, websiteUrl: e.websiteUrl })),
    suggestedUnconfirmed: ents.filter((e) => e.origin === 'bb_suggested' && e.relevanceStatus !== 'confirmed' && e.relevanceStatus !== 'dismissed').map((e) => ({ id: e.id, name: e.name, entityType: e.entityType })),
    observed: kept.filter((f) => f.inferenceText === null).map((f) => ({ id: f.id, entityId: f.marketEntityId, sourceUrl: f.sourceUrl, observedText: f.observedText, founderResponse: f.founderResponse, qualification: f.founderQualification })),
    inferences: kept.filter((f) => f.inferenceText !== null).map((f) => ({ id: f.id, entityId: f.marketEntityId, inferenceText: f.inferenceText!, epistemicStatus: f.epistemicStatus, founderResponse: f.founderResponse, qualification: f.founderQualification })),
  };
}
