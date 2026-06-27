import type { KyselyDB } from '../client';
import type { FounderStatus } from '@bb/shared';

export interface FounderStatusProjection {
  founderId: string;
  status: FounderStatus;
  name: string;
  businessName: string;
  timezone: string;
  activatedAt: Date | null;
  pausedAt: Date | null;
}

/**
 * Read-optimised projection for founder status.
 * Updated by the Projection Worker on FounderProfile events.
 * Source: Repository Structure V1 Section 02.
 */
export class PgFounderStatusProjection {
  constructor(private readonly db: KyselyDB) {}

  async find(founderId: string): Promise<FounderStatusProjection | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('app.founder_status_projection')
      .selectAll()
      .where('founder_id', '=', founderId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      founderId:    row.founder_id,
      status:       row.status,
      name:         row.name,
      businessName: row.business_name,
      timezone:     row.timezone,
      activatedAt:  row.activated_at ? new Date(row.activated_at) : null,
      pausedAt:     row.paused_at ? new Date(row.paused_at) : null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async upsert(projection: FounderStatusProjection, tx?: unknown): Promise<void> {
    const db = (tx ?? this.db) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = {
      founder_id:    projection.founderId,
      status:        projection.status,
      name:          projection.name,
      business_name: projection.businessName,
      timezone:      projection.timezone,
      activated_at:  projection.activatedAt?.toISOString() ?? null,
      paused_at:     projection.pausedAt?.toISOString() ?? null,
      updated_at:    new Date().toISOString(),
    };
    await db
      .insertInto('app.founder_status_projection')
      .values(row)
      .onConflict((oc: any) => oc.column('founder_id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }
}
