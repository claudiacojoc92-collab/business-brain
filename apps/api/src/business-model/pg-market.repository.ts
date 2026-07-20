/**
 * Pg repositories for Wave 3 market context (V061). Entities are founder-scoped and deduped by
 * (founder, normalized_name). Findings are append-only with full provenance; observation and inference live
 * in separate columns. No FK cascade (delete coverage explicit in delete.service).
 */
import { generateId } from '@bb/shared';
import { normalizeName, DuplicateEntityNameError, type EntityOrigin, type EntityType, type MarketEntity, type MarketFinding, type RelevanceStatus } from './market-context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgMarketEntityRepository {
  constructor(private readonly db: AnyDB) {}

  /** Add or update an entity (dedupe by normalized name). Returns the row. */
  async upsert(founderId: string, e: { name: string; websiteUrl?: string | null; entityType?: EntityType; origin: EntityOrigin; relevanceNote?: string | null; relevanceStatus?: RelevanceStatus }, now: Date): Promise<MarketEntity> {
    const norm = normalizeName(e.name);
    const nowIso = now.toISOString();
    await this.db.insertInto('business.market_entity').values({
      id: generateId(), founder_id: founderId, name: e.name.trim(), normalized_name: norm, website_url: e.websiteUrl ?? null,
      entity_type: e.entityType ?? 'direct', origin: e.origin, relevance_status: e.relevanceStatus ?? (e.origin === 'founder_added' ? 'confirmed' : 'proposed'),
      relevance_note: e.relevanceNote ?? null, created_at: nowIso, updated_at: nowIso,
    }).onConflict((oc: AnyDB) => oc.columns(['founder_id', 'normalized_name']).doUpdateSet({
      name: e.name.trim(), website_url: e.websiteUrl ?? null, entity_type: e.entityType ?? 'direct', relevance_note: e.relevanceNote ?? null, updated_at: nowIso,
    })).execute();
    return (await this.getByName(founderId, norm))!;
  }
  async getByName(founderId: string, normalizedName: string): Promise<MarketEntity | null> {
    const r = await this.db.selectFrom('business.market_entity').selectAll().where('founder_id', '=', founderId).where('normalized_name', '=', normalizedName).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async get(founderId: string, id: string): Promise<MarketEntity | null> {
    const r = await this.db.selectFrom('business.market_entity').selectAll().where('founder_id', '=', founderId).where('id', '=', id).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  async list(founderId: string): Promise<MarketEntity[]> {
    const rows = await this.db.selectFrom('business.market_entity').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'desc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  async patch(founderId: string, id: string, patch: { name?: string; entityType?: EntityType; websiteUrl?: string | null; relevanceNote?: string | null; relevanceStatus?: RelevanceStatus; dismissedAt?: Date | null; websiteChangedAt?: Date }, now: Date): Promise<MarketEntity | null> {
    const set: Record<string, unknown> = { updated_at: now.toISOString() };
    if (patch.name !== undefined) { set['name'] = patch.name.trim(); set['normalized_name'] = normalizeName(patch.name); }
    if (patch.entityType) set['entity_type'] = patch.entityType;
    if (patch.websiteUrl !== undefined) set['website_url'] = patch.websiteUrl;
    if (patch.relevanceNote !== undefined) set['relevance_note'] = patch.relevanceNote;
    if (patch.relevanceStatus) set['relevance_status'] = patch.relevanceStatus;
    if (patch.dismissedAt !== undefined) set['dismissed_at'] = patch.dismissedAt ? patch.dismissedAt.toISOString() : null;
    if (patch.websiteChangedAt !== undefined) set['website_changed_at'] = patch.websiteChangedAt.toISOString();
    try {
      const r = await this.db.updateTable('business.market_entity').set(set).where('founder_id', '=', founderId).where('id', '=', id).returningAll().executeTakeFirst();
      return r ? this.toDomain(r) : null;
    } catch (e) {
      // normalized-name unique-index violation → the founder already has an entity with that name
      if (patch.name !== undefined) throw new DuplicateEntityNameError();
      throw e;
    }
  }
  private toDomain(r: AnyDB): MarketEntity {
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    return { id: r.id, founderId: r.founder_id, name: r.name, normalizedName: r.normalized_name, websiteUrl: r.website_url ?? null, entityType: r.entity_type, origin: r.origin, relevanceStatus: r.relevance_status, relevanceNote: r.relevance_note ?? null, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(), dismissedAt: iso(r.dismissed_at), websiteChangedAt: iso(r.website_changed_at) };
  }
}

export class PgMarketFindingRepository {
  constructor(private readonly db: AnyDB) {}
  async append(f: Omit<MarketFinding, 'id' | 'createdAt'>, now: Date, tx?: unknown): Promise<MarketFinding> {
    const id = generateId();
    const db = (tx ?? this.db) as AnyDB;
    await db.insertInto('business.market_finding').values({
      id, founder_id: f.founderId, market_entity_id: f.marketEntityId, review_id: f.reviewId, source_url: f.sourceUrl, canonical_url: f.canonicalUrl,
      source_title: f.sourceTitle, source_type: f.sourceType, retrieved_at: f.retrievedAt, retrieval_adapter: f.retrievalAdapter,
      extraction_version: f.extractionVersion, observed_text: f.observedText, evidence_fragment_id: f.evidenceFragmentId,
      inference_text: f.inferenceText, epistemic_status: f.epistemicStatus, relevance_to_founder: f.relevanceToFounder,
      model_version: f.modelVersion, prompt_version: f.promptVersion,
      founder_response: f.founderResponse, founder_qualification: f.founderQualification, supersedes_id: f.supersedesId, created_at: now.toISOString(),
    }).execute();
    return { ...f, id, createdAt: now.toISOString() };
  }
  async listByEntity(founderId: string, marketEntityId: string): Promise<MarketFinding[]> {
    const rows = await this.db.selectFrom('business.market_finding').selectAll().where('founder_id', '=', founderId).where('market_entity_id', '=', marketEntityId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  async listByFounder(founderId: string): Promise<MarketFinding[]> {
    const rows = await this.db.selectFrom('business.market_finding').selectAll().where('founder_id', '=', founderId).orderBy('created_at', 'asc').execute();
    return (rows as AnyDB[]).map((r) => this.toDomain(r));
  }
  /** One finding, founder-scoped — used to prove ownership before recording a response (isolation). */
  async getById(founderId: string, id: string): Promise<MarketFinding | null> {
    const r = await this.db.selectFrom('business.market_finding').selectAll().where('founder_id', '=', founderId).where('id', '=', id).executeTakeFirst();
    return r ? this.toDomain(r) : null;
  }
  private toDomain(r: AnyDB): MarketFinding {
    return { id: r.id, founderId: r.founder_id, marketEntityId: r.market_entity_id, reviewId: r.review_id ?? null, sourceUrl: r.source_url, canonicalUrl: r.canonical_url ?? null, sourceTitle: r.source_title ?? null, sourceType: r.source_type, retrievedAt: new Date(r.retrieved_at).toISOString(), retrievalAdapter: r.retrieval_adapter, extractionVersion: r.extraction_version, observedText: r.observed_text, evidenceFragmentId: r.evidence_fragment_id ?? null, inferenceText: r.inference_text ?? null, epistemicStatus: r.epistemic_status, relevanceToFounder: r.relevance_to_founder ?? null, founderResponse: r.founder_response, founderQualification: r.founder_qualification ?? null, modelVersion: r.model_version ?? null, promptVersion: r.prompt_version ?? null, supersedesId: r.supersedes_id ?? null, createdAt: new Date(r.created_at).toISOString() };
  }
}
