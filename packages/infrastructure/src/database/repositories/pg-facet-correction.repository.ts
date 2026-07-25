import type { KyselyDB } from '../client';
import type { FacetCorrection, FacetCorrectionRepository, SubjectRef } from '@bb/domain';
import { businessRefKey } from '@bb/domain';

/**
 * Append-only FacetCorrection store (understanding.facet_correction). Business-scoped. The correction
 * WRITE workflow (command/route/RevisionCoordinator) is deferred to Commit 6; this adapter provides
 * append + listActive so the EffectiveFacetResolver can compose base ⊕ corrections.
 */
export class PgFacetCorrectionRepository implements FacetCorrectionRepository {
  constructor(private readonly db: KyselyDB) {}

  async append(businessRef: SubjectRef, corrections: readonly FacetCorrection[]): Promise<void> {
    if (corrections.length === 0) return;
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    for (const c of corrections) {
      await db
        .insertInto('understanding.facet_correction')
        .values({
          business_ref: brk,
          id: c.id,
          observation_id: c.observationId,
          kind: c.kind,
          from_value: c.from,
          to_value: c.to,
          by: c.by,
          at: c.at,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onConflict((oc: any) => oc.columns(['business_ref', 'id']).doNothing())
        .execute();
    }
  }

  async listActive(businessRef: SubjectRef): Promise<readonly FacetCorrection[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.facet_correction')
      .selectAll()
      .where('business_ref', '=', businessRefKey(businessRef))
      .execute()) as unknown[];
    return rows.map((r) => toDomain(r));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDomain(row: any): FacetCorrection {
  return {
    id: row.id,
    observationId: row.observation_id,
    kind: row.kind,
    from: row.from_value,
    to: row.to_value,
    by: row.by,
    at: typeof row.at === 'string' ? row.at : new Date(row.at).toISOString(),
  };
}
