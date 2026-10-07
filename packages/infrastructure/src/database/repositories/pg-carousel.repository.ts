import type { KyselyDB } from '../client';
import { generateId } from '@bb/shared';
import type {
  ICarouselRepository, CarouselAsset, CarouselAssetVersion, AssetAuthorizationSnapshot, RenderVersion, CarouselRevisionEvent,
  Concept, Slide, VisualSystem, CarouselBrief, CarouselSourceRef, GateReport, SlideImage, CanvasSpec,
  CarouselProposition, CarouselSafetyTrace, BrandConstraints,
} from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const parse = <T>(v: any, fb: T): T => { if (v == null) return fb; return typeof v === 'string' ? JSON.parse(v) : v; };

function toVersion(r: any): CarouselAssetVersion {
  return {
    versionId: r.version_id, assetId: r.asset_id, versionNumber: r.version_number, businessId: r.business_id,
    brief: parse<CarouselBrief>(r.brief, {} as CarouselBrief), concept: parse<Concept>(r.concept, {} as Concept),
    slides: parse<Slide[]>(r.slides, []), visualSystem: parse<VisualSystem>(r.visual_system, {} as VisualSystem),
    brandContextVersion: r.brand_context_version, languageContext: r.language_context, authorizationSnapshotId: r.authorization_snapshot_id,
    sourceManifest: parse<CarouselSourceRef[]>(r.source_manifest, []), contentHash: r.content_hash, producedAt: iso(r.produced_at),
  };
}
function toRender(r: any): RenderVersion {
  return {
    renderId: r.render_id, versionId: r.version_id, rendererVersion: r.renderer_version,
    canvasSpec: parse<CanvasSpec>(r.canvas_spec, {} as CanvasSpec), slideImages: parse<SlideImage[]>(r.slide_images, []),
    exportZipKey: r.export_zip_key ?? null, gateReport: parse<GateReport>(r.gate_report, { valid: false, findings: [] }), producedAt: iso(r.produced_at),
  };
}

/** Slice 6 carousel persistence. Asset content + authorization snapshot + render are INSERT-ONLY (immutable);
 * only the asset's current_version_id pointer and appended revision events change. */
export class PgCarouselRepository implements ICarouselRepository {
  constructor(private readonly db_: KyselyDB) {}

  async saveVersion(v: CarouselAssetVersion): Promise<void> {
    await (this.db_ as any).insertInto('workspace.carousel_asset_version').values({
      version_id: v.versionId, asset_id: v.assetId, version_number: v.versionNumber, business_id: v.businessId,
      brief: JSON.stringify(v.brief), concept: JSON.stringify(v.concept), slides: JSON.stringify(v.slides), visual_system: JSON.stringify(v.visualSystem),
      brand_context_version: v.brandContextVersion, language_context: v.languageContext, authorization_snapshot_id: v.authorizationSnapshotId,
      source_manifest: JSON.stringify(v.sourceManifest), content_hash: v.contentHash, produced_at: v.producedAt,
    }).execute();
  }
  async getVersion(businessId: string, versionId: string): Promise<CarouselAssetVersion | null> {
    const r = await (this.db_ as any).selectFrom('workspace.carousel_asset_version').selectAll().where('business_id', '=', businessId).where('version_id', '=', versionId).executeTakeFirst();
    return r ? toVersion(r) : null;
  }
  async saveAsset(a: CarouselAsset): Promise<void> {
    await (this.db_ as any).insertInto('workspace.carousel_asset').values({
      asset_id: a.assetId, business_id: a.businessId, create_handoff_id: a.createHandoffId, plan_version_id: a.planVersionId,
      strategy_version_id: a.strategyVersionId, current_version_id: a.currentVersionId, created_at: a.createdAt,
    }).onConflict((oc: any) => oc.column('asset_id').doNothing()).execute();
  }
  async getAsset(businessId: string, assetId: string): Promise<CarouselAsset | null> {
    const r = await (this.db_ as any).selectFrom('workspace.carousel_asset').selectAll().where('business_id', '=', businessId).where('asset_id', '=', assetId).executeTakeFirst();
    return r ? { assetId: r.asset_id, businessId: r.business_id, createHandoffId: r.create_handoff_id, planVersionId: r.plan_version_id, strategyVersionId: r.strategy_version_id, currentVersionId: r.current_version_id, createdAt: iso(r.created_at) } : null;
  }
  async getAssetByHandoff(businessId: string, createHandoffId: string): Promise<CarouselAsset | null> {
    const r = await (this.db_ as any).selectFrom('workspace.carousel_asset').selectAll().where('business_id', '=', businessId).where('create_handoff_id', '=', createHandoffId).executeTakeFirst();
    return r ? { assetId: r.asset_id, businessId: r.business_id, createHandoffId: r.create_handoff_id, planVersionId: r.plan_version_id, strategyVersionId: r.strategy_version_id, currentVersionId: r.current_version_id, createdAt: iso(r.created_at) } : null;
  }
  async setCurrentVersion(assetId: string, versionId: string): Promise<void> {
    await (this.db_ as any).updateTable('workspace.carousel_asset').set({ current_version_id: versionId }).where('asset_id', '=', assetId).execute();
  }
  async saveAuthorizationSnapshot(s: AssetAuthorizationSnapshot): Promise<void> {
    await (this.db_ as any).insertInto('workspace.carousel_authorization_snapshot').values({
      snapshot_id: s.snapshotId, business_id: s.businessId, create_handoff_id: s.createHandoffId, strategy_version_id: s.strategyVersionId,
      language: s.language, speaking_role: s.speakingRole, audience_use_context: s.audienceUseContext,
      licensed_propositions: JSON.stringify(s.licensedPropositions), proof_facts: JSON.stringify(s.proofFacts), cta_function: s.ctaFunction,
      owned_stances: JSON.stringify(s.ownedStances), source_refs: JSON.stringify(s.sourceRefs), model_id: s.modelId, safety_contract_hash: s.safetyContractHash, produced_at: s.producedAt,
    }).execute();
  }
  async getAuthorizationSnapshot(businessId: string, snapshotId: string): Promise<AssetAuthorizationSnapshot | null> {
    const r = await (this.db_ as any).selectFrom('workspace.carousel_authorization_snapshot').selectAll().where('business_id', '=', businessId).where('snapshot_id', '=', snapshotId).executeTakeFirst();
    if (!r) return null;
    return {
      snapshotId: r.snapshot_id, businessId: r.business_id, createHandoffId: r.create_handoff_id, strategyVersionId: r.strategy_version_id,
      language: r.language, speakingRole: r.speaking_role, audienceUseContext: r.audience_use_context,
      licensedPropositions: parse<CarouselProposition[]>(r.licensed_propositions, []), proofFacts: parse<string[]>(r.proof_facts, []), ctaFunction: r.cta_function,
      ownedStances: parse<string[]>(r.owned_stances, []), sourceRefs: parse<CarouselSourceRef[]>(r.source_refs, []),
      modelId: r.model_id ?? null, safetyContractHash: r.safety_contract_hash ?? null, producedAt: iso(r.produced_at),
    };
  }
  async saveSafetyTrace(t: CarouselSafetyTrace): Promise<void> {
    await (this.db_ as any).insertInto('workspace.carousel_safety_trace').values({
      trace_id: t.traceId, business_id: t.businessId, asset_id: t.assetId, version_id: t.versionId, attempt: t.attempt,
      authorization_snapshot_id: t.authorizationSnapshotId, proposition_contract_hash: t.propositionContractHash,
      judge_model_id: t.judgeModelId, judge_prompt_hash: t.judgePromptHash,
      layer1_findings: JSON.stringify(t.layer1Findings), layer2_permitted: JSON.stringify(t.layer2Permitted),
      semantic_block_findings: JSON.stringify(t.semanticBlockFindings), full_asset_findings: JSON.stringify(t.fullAssetFindings),
      repair_reasons: JSON.stringify(t.repairReasons), disposition: t.disposition,
      generation_mode: t.generationMode, fallback_bindings_hash: t.fallbackBindingsHash,
      targeted_repair: t.targetedRepair ? JSON.stringify(t.targetedRepair) : null, produced_at: t.producedAt,
    }).execute();
  }
  async saveMedia(businessId: string, m: CarouselSourceRef & { filename?: string }): Promise<void> {
    await (this.db_ as any).insertInto('workspace.carousel_media').values({
      source_ref_id: m.sourceRefId, business_id: businessId, source_type: m.sourceType, provenance: m.provenance,
      reuse_right: m.reuseRight, media_ref: m.mediaRef ?? '', filename: m.filename ?? null, created_at: new Date().toISOString(),
    }).onConflict((oc: any) => oc.column('source_ref_id').doNothing()).execute();
  }
  async listMedia(businessId: string): Promise<CarouselSourceRef[]> {
    const rows = await (this.db_ as any).selectFrom('workspace.carousel_media').selectAll().where('business_id', '=', businessId).orderBy('created_at', 'desc').execute();
    return (rows as any[]).map((r) => ({ sourceRefId: r.source_ref_id, sourceType: r.source_type, provenance: r.provenance, reuseRight: r.reuse_right, mediaRef: r.media_ref }));
  }
  async saveBrand(businessId: string, b: BrandConstraints & { source: string }): Promise<void> {
    await (this.db_ as any).insertInto('workspace.carousel_brand').values({
      business_id: businessId, palette: JSON.stringify(b.palette ?? []), logo_ref: b.logoRef ?? null,
      type_preference: b.typePreference ?? null, imagery_style: b.imageryStyle ?? null,
      explicit_donts: JSON.stringify(b.explicitDonts ?? []), source: b.source, updated_at: new Date().toISOString(),
    }).onConflict((oc: any) => oc.column('business_id').doUpdateSet({
      palette: JSON.stringify(b.palette ?? []), logo_ref: b.logoRef ?? null, type_preference: b.typePreference ?? null,
      imagery_style: b.imageryStyle ?? null, explicit_donts: JSON.stringify(b.explicitDonts ?? []), source: b.source, updated_at: new Date().toISOString(),
    })).execute();
  }
  async getBrand(businessId: string): Promise<BrandConstraints | null> {
    const r = await (this.db_ as any).selectFrom('workspace.carousel_brand').selectAll().where('business_id', '=', businessId).executeTakeFirst();
    if (!r) return null;
    const palette = parse<string[]>(r.palette, []);
    return { ...(palette.length ? { palette } : {}), ...(r.logo_ref ? { logoRef: r.logo_ref } : {}), ...(r.type_preference ? { typePreference: r.type_preference } : {}), ...(r.imagery_style ? { imageryStyle: r.imagery_style } : {}), explicitDonts: parse<string[]>(r.explicit_donts, []) };
  }
  async saveRender(r: RenderVersion): Promise<void> {
    await (this.db_ as any).insertInto('workspace.carousel_render').values({
      render_id: r.renderId, version_id: r.versionId, renderer_version: r.rendererVersion, canvas_spec: JSON.stringify(r.canvasSpec),
      slide_images: JSON.stringify(r.slideImages), export_zip_key: r.exportZipKey, gate_report: JSON.stringify(r.gateReport), produced_at: r.producedAt,
    }).execute();
  }
  async getRender(versionId: string): Promise<RenderVersion | null> {
    const r = await (this.db_ as any).selectFrom('workspace.carousel_render').selectAll().where('version_id', '=', versionId).orderBy('produced_at', 'desc').executeTakeFirst();
    return r ? toRender(r) : null;
  }
  async recordRevision(e: Omit<CarouselRevisionEvent, 'id'>): Promise<void> {
    await (this.db_ as any).insertInto('workspace.carousel_revision_event').values({
      id: generateId(), asset_id: e.assetId, from_version_id: e.fromVersionId, to_version_id: e.toVersionId, scope: JSON.stringify(e.scope), at: e.at,
    }).execute();
  }
}
