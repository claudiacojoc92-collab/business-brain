import type { KyselyDB } from '../client';

export interface CurrentCycleProjection {
  cycleId: string;
  founderId: string;
  cycleNumber: number;
  status: string;
  selectedMode: string | null;
  isFallback: boolean;
  committedAt: Date | null;
}

/**
 * Read-optimised projection for the current weekly cycle.
 * Source: Repository Structure V1 Section 02.
 */
export class PgCurrentCycleProjection {
  constructor(private readonly db: KyselyDB) {}

  async find(founderId: string): Promise<CurrentCycleProjection | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('app.current_cycle_projection')
      .selectAll()
      .where('founder_id', '=', founderId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      cycleId:      row.cycle_id,
      founderId:    row.founder_id,
      cycleNumber:  row.cycle_number,
      status:       row.status,
      selectedMode: row.selected_mode ?? null,
      isFallback:   row.is_fallback ?? false,
      committedAt:  row.committed_at ? new Date(row.committed_at) : null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async upsert(projection: CurrentCycleProjection, tx?: unknown): Promise<void> {
    const db = (tx ?? this.db) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = {
      cycle_id:     projection.cycleId,
      founder_id:   projection.founderId,
      cycle_number: projection.cycleNumber,
      status:       projection.status,
      selected_mode:projection.selectedMode,
      is_fallback:  projection.isFallback,
      committed_at: projection.committedAt?.toISOString() ?? null,
      updated_at:   new Date().toISOString(),
    };
    await db
      .insertInto('app.current_cycle_projection')
      .values(row)
      .onConflict((oc: any) => oc.column('founder_id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }
}
