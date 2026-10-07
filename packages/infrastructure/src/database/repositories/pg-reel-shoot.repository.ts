import type { KyselyDB } from '../client';
import type { IReelShootRepository, ReelConcept, ShootingPlanVersion, FulfillmentReport, ReelShootContext } from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const parse = <T>(v: any, fb: T): T => { if (v == null) return fb; return typeof v === 'string' ? JSON.parse(v) : v; };

/** Slice 7 V2 — "Tell me what to film" persistence. Immutable concept, append-only plan versions, one fulfillment
 *  report per plan-version, and the ReelShootContext companion that links the lineage to the frozen V1 asset. */
export class PgReelShootRepository implements IReelShootRepository {
  constructor(private readonly db_: KyselyDB) {}
  private db(): any { return this.db_ as any; }

  async saveConcept(x: ReelConcept): Promise<void> {
    await this.db().insertInto('workspace.reel_concept').values({ reel_concept_id: x.reelConceptId, business_id: x.businessId, strategy_version_id: x.strategyVersionId, payload: JSON.stringify(x), content_hash: x.contentHash, produced_at: x.producedAt })
      .onConflict((c: any) => c.column('reel_concept_id').doNothing()).execute();
  }
  async getConcept(businessId: string, id: string): Promise<ReelConcept | null> {
    const r = await this.db().selectFrom('workspace.reel_concept').selectAll().where('business_id', '=', businessId).where('reel_concept_id', '=', id).executeTakeFirst();
    return r ? parse<ReelConcept>(r.payload, {} as ReelConcept) : null;
  }
  async savePlanVersion(x: ShootingPlanVersion): Promise<void> {
    await this.db().insertInto('workspace.reel_shooting_plan_version').values({ version_id: x.versionId, shooting_plan_id: x.shootingPlanId, reel_concept_id: x.reelConceptId, business_id: x.businessId, version_number: x.versionNumber, supersedes_version_id: x.supersedesVersionId, payload: JSON.stringify(x), content_hash: x.contentHash, produced_at: x.producedAt })
      .onConflict((c: any) => c.column('version_id').doNothing()).execute();
  }
  async getPlanVersion(businessId: string, versionId: string): Promise<ShootingPlanVersion | null> {
    const r = await this.db().selectFrom('workspace.reel_shooting_plan_version').selectAll().where('business_id', '=', businessId).where('version_id', '=', versionId).executeTakeFirst();
    return r ? parse<ShootingPlanVersion>(r.payload, {} as ShootingPlanVersion) : null;
  }
  async getCurrentPlanVersion(businessId: string, shootingPlanId: string): Promise<ShootingPlanVersion | null> {
    const r = await this.db().selectFrom('workspace.reel_shooting_plan_version').selectAll().where('business_id', '=', businessId).where('shooting_plan_id', '=', shootingPlanId).orderBy('version_number', 'desc').executeTakeFirst();
    return r ? parse<ShootingPlanVersion>(r.payload, {} as ShootingPlanVersion) : null;
  }
  async saveFulfillmentReport(x: FulfillmentReport & { businessId: string }): Promise<void> {
    await this.db().insertInto('workspace.reel_shot_fulfillment').values({ shooting_plan_version_id: x.shootingPlanVersionId, business_id: x.businessId, video_set_understanding_id: x.videoSetUnderstandingId, sufficiency: x.sufficiency, payload: JSON.stringify(x), produced_at: x.producedAt })
      .onConflict((c: any) => c.column('shooting_plan_version_id').doUpdateSet({ video_set_understanding_id: x.videoSetUnderstandingId, sufficiency: x.sufficiency, payload: JSON.stringify(x), produced_at: x.producedAt })).execute();
  }
  async getFulfillmentReport(businessId: string, shootingPlanVersionId: string): Promise<FulfillmentReport | null> {
    const r = await this.db().selectFrom('workspace.reel_shot_fulfillment').selectAll().where('business_id', '=', businessId).where('shooting_plan_version_id', '=', shootingPlanVersionId).executeTakeFirst();
    return r ? parse<FulfillmentReport>(r.payload, {} as FulfillmentReport) : null;
  }
  async saveShootContext(x: ReelShootContext): Promise<void> {
    await this.db().insertInto('workspace.reel_shoot_context').values({ reel_shoot_context_id: x.reelShootContextId, business_id: x.businessId, reel_concept_id: x.reelConceptId, shooting_plan_version_id: x.shootingPlanVersionId, video_set_understanding_id: x.videoSetUnderstandingId, opportunity_id: x.opportunityId, asset_id: x.assetId, payload: JSON.stringify(x), produced_at: x.producedAt })
      .onConflict((c: any) => c.column('reel_shoot_context_id').doNothing()).execute();
  }
  async getShootContextByAsset(businessId: string, assetId: string): Promise<ReelShootContext | null> {
    const r = await this.db().selectFrom('workspace.reel_shoot_context').selectAll().where('business_id', '=', businessId).where('asset_id', '=', assetId).executeTakeFirst();
    return r ? parse<ReelShootContext>(r.payload, {} as ReelShootContext) : null;
  }
  async getShootContextByPlan(businessId: string, shootingPlanVersionId: string): Promise<ReelShootContext | null> {
    const r = await this.db().selectFrom('workspace.reel_shoot_context').selectAll().where('business_id', '=', businessId).where('shooting_plan_version_id', '=', shootingPlanVersionId).orderBy('produced_at', 'desc').executeTakeFirst();
    return r ? parse<ReelShootContext>(r.payload, {} as ReelShootContext) : null;
  }
}
