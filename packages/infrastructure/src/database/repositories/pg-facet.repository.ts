import type { KyselyDB } from '../client';
import type { Facet, FacetRepository, ObservationId, SubjectRef } from '@bb/domain';
import { businessRefKey } from '@bb/domain';

/**
 * Append-only Facet store (understanding.facet). Business-scoped (business_ref, id). Content-addressed
 * ids dedupe (idempotent no-op); a DIFFERENT payload under an existing id fails loudly. Facets from an
 * older profile are never overwritten (different extraction_profile ⇒ different id).
 */
export class PgFacetRepository implements FacetRepository {
  constructor(private readonly db: KyselyDB) {}

  async appendResults(businessRef: SubjectRef, facets: readonly Facet[]): Promise<void> {
    if (facets.length === 0) return;
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    for (const f of facets) {
      const existing = await db
        .selectFrom('understanding.facet')
        .select(['kind', 'value'])
        .where('business_ref', '=', brk)
        .where('id', '=', f.id)
        .executeTakeFirst();
      if (existing) {
        if (existing.kind !== f.kind || existing.value !== f.value) {
          throw new Error(`facet content conflict for id ${f.id} (business ${brk})`);
        }
        continue;
      }
      await db
        .insertInto('understanding.facet')
        .values({
          business_ref: brk,
          id: f.id,
          observation_id: f.observationId,
          kind: f.kind,
          value: f.value,
          mode: f.mode,
          confidence: f.confidence,
          rule_key: f.ruleKey,
          rule_version: f.ruleVersion,
          extraction_profile: f.extractionProfile,
          created_at: new Date().toISOString(), // operational; NOT part of the id
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onConflict((oc: any) => oc.columns(['business_ref', 'id']).doNothing())
        .execute();
    }
  }

  async listRaw(
    businessRef: SubjectRef,
    observationIds: readonly ObservationId[],
    extractionProfile: string,
  ): Promise<readonly Facet[]> {
    if (observationIds.length === 0) return [];
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.facet')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('extraction_profile', '=', extractionProfile)
      .where('observation_id', 'in', [...observationIds])
      .execute()) as unknown[];
    return rows.map((r) => toDomain(r));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDomain(row: any): Facet {
  return {
    id: row.id,
    observationId: row.observation_id,
    kind: row.kind,
    value: row.value,
    mode: row.mode,
    confidence: row.confidence,
    ruleKey: row.rule_key,
    ruleVersion: row.rule_version,
    extractionProfile: row.extraction_profile,
  };
}
