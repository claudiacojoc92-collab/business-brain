import type { KyselyDB } from '../client';
import type { OutcomeType } from '@bb/shared';

export interface OutcomeHistoryItem {
  outcomeId: string;
  founderId: string;
  outcomeType: OutcomeType;
  attributionStatus: string;
  reportedAt: Date;
  confirmedAt: Date | null;
}

/**
 * Read-optimised projection for outcome history.
 * Source: Repository Structure V1 Section 02.
 */
export class PgOutcomeHistoryProjection {
  constructor(private readonly db: KyselyDB) {}

  async findByFounder(founderId: string, limit = 20): Promise<OutcomeHistoryItem[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (this.db as any)
      .selectFrom('app.outcome_history_projection')
      .selectAll()
      .where('founder_id', '=', founderId)
      .orderBy('reported_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      outcomeId:         r.outcome_id,
      founderId:         r.founder_id,
      outcomeType:       r.outcome_type,
      attributionStatus: r.attribution_status,
      reportedAt:        new Date(r.reported_at),
      confirmedAt:       r.confirmed_at ? new Date(r.confirmed_at) : null,
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async upsert(item: OutcomeHistoryItem, tx?: unknown): Promise<void> {
    const db = (tx ?? this.db) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = {
      outcome_id:         item.outcomeId,
      founder_id:         item.founderId,
      outcome_type:       item.outcomeType,
      attribution_status: item.attributionStatus,
      reported_at:        item.reportedAt.toISOString(),
      confirmed_at:       item.confirmedAt?.toISOString() ?? null,
      updated_at:         new Date().toISOString(),
    };
    await db
      .insertInto('app.outcome_history_projection')
      .values(row)
      .onConflict((oc: any) => oc.column('outcome_id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }
}
