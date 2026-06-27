import type { KyselyDB } from '../client';
import type { ICampaignRepository } from '@bb/domain';
import { Campaign, CampaignPhase } from '@bb/domain';

/**
 * PostgreSQL implementation of ICampaignRepository.
 * Source: Implementation Spec V1 Section 08, Database Design V1 Section 07.
 */
export class PgCampaignRepository implements ICampaignRepository {
  constructor(private readonly db: KyselyDB) {}

  async findById(id: string): Promise<Campaign | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('campaign.campaigns')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    const phases = await this.findPhases(id);
    return this.toDomain(row, phases);
  }

  async findActive(founderId: string): Promise<Campaign | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('campaign.campaigns')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!row) return null;
    const phases = await this.findPhases(row.id);
    return this.toDomain(row, phases);
  }

  async hasActiveCampaign(founderId: string): Promise<boolean> {
    const campaign = await this.findActive(founderId);
    return campaign !== null;
  }

  async save(campaign: Campaign, tx: unknown): Promise<void> {
    const row = this.toPersistence(campaign);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)
      .insertInto('campaign.campaigns')
      .values(row)
      .onConflict((oc: any) => oc.column('id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }

  async findHistory(
    founderId: string,
    limit: number,
    _cursor?: string,
  ): Promise<Campaign[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (this.db as any)
      .selectFrom('campaign.campaigns')
      .selectAll()
      .where('founder_id', '=', founderId)
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute();
    return Promise.all(
      rows.map(async (r) => {
        const phases = await this.findPhases(r.id);
        return this.toDomain(r, phases);
      }),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findPhases(campaignId: string): Promise<any[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db as any)
      .selectFrom('campaign.campaign_phases')
      .selectAll()
      .where('campaign_id', '=', campaignId)
      .orderBy('phase_index', 'asc')
      .execute();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toDomain(row: any, phaseRows: any[]): Campaign {
    const phases = phaseRows.map(
      (p) =>
        new CampaignPhase({
          id:                     p.id,
          campaignId:             p.campaign_id,
          founderId:              p.founder_id,
          phaseIndex:             p.phase_index,
          mode:                   p.mode,
          beliefTarget:           p.belief_target,
          expectedAudienceChange: p.expected_audience_change,
          assignedCycleId:        p.assigned_cycle_id ?? null,
          executedAt:             p.executed_at ? new Date(p.executed_at) : null,
        }),
    );
    return Campaign.reconstitute({
      id:                 row.id,
      founderId:          row.founder_id,
      campaignType:       row.campaign_type,
      status:             row.status,
      beliefTarget:       row.belief_target,
      successCriteria:    (row.success_criteria ?? {}) as Record<string, unknown>,
      maxDurationWeeks:   row.max_duration_weeks,
      phases,
      startedAt:          row.started_at ? new Date(row.started_at) : null,
      completedAt:        row.completed_at ? new Date(row.completed_at) : null,
      interruptedAt:      row.interrupted_at ? new Date(row.interrupted_at) : null,
      interruptionReason: row.interruption_reason ?? null,
      succeededAt:        row.succeeded_at ? new Date(row.succeeded_at) : null,
      failedAt:           row.failed_at ? new Date(row.failed_at) : null,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPersistence(campaign: Campaign): Record<string, any> {
    return {
      id:                   campaign.id,
      founder_id:           campaign.founderId,
      campaign_type:        campaign.campaignType,
      status:               campaign.status,
      belief_target:        campaign.beliefTarget,
      success_criteria:     JSON.stringify(campaign.successCriteria),
      max_duration_weeks:   campaign.maxDurationWeeks,
      started_at:           campaign.startedAt?.toISOString() ?? null,
      completed_at:         campaign.completedAt?.toISOString() ?? null,
      interrupted_at:       campaign.interruptedAt?.toISOString() ?? null,
      interruption_reason:  campaign.interruptionReason,
      succeeded_at:         campaign.succeededAt?.toISOString() ?? null,
      failed_at:            campaign.failedAt?.toISOString() ?? null,
    };
  }
}
