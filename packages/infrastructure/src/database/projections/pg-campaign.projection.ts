import type { KyselyDB } from '../client';

export interface CampaignProjection {
  campaignId: string;
  founderId: string;
  campaignType: string;
  status: string;
  beliefTarget: string;
  phasesCompleted: number;
  totalPhases: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Read-optimised projection for campaigns.
 * Source: Repository Structure V1 Section 02.
 */
export class PgCampaignProjection {
  constructor(private readonly db: KyselyDB) {}

  async findActive(founderId: string): Promise<CampaignProjection | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('app.campaign_projection')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!row) return null;
    return this.toProjection(row);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async upsert(projection: CampaignProjection, tx?: unknown): Promise<void> {
    const db = (tx ?? this.db) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = {
      campaign_id:      projection.campaignId,
      founder_id:       projection.founderId,
      campaign_type:    projection.campaignType,
      status:           projection.status,
      belief_target:    projection.beliefTarget,
      phases_completed: projection.phasesCompleted,
      total_phases:     projection.totalPhases,
      started_at:       projection.startedAt?.toISOString() ?? null,
      completed_at:     projection.completedAt?.toISOString() ?? null,
      updated_at:       new Date().toISOString(),
    };
    await db
      .insertInto('app.campaign_projection')
      .values(row)
      .onConflict((oc: any) => oc.column('campaign_id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toProjection(row: any): CampaignProjection {
    return {
      campaignId:      row.campaign_id,
      founderId:       row.founder_id,
      campaignType:    row.campaign_type,
      status:          row.status,
      beliefTarget:    row.belief_target,
      phasesCompleted: row.phases_completed ?? 0,
      totalPhases:     row.total_phases ?? 0,
      startedAt:       row.started_at ? new Date(row.started_at) : null,
      completedAt:     row.completed_at ? new Date(row.completed_at) : null,
    };
  }
}
