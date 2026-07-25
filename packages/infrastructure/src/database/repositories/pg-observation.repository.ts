import type { KyselyDB } from '../client';
import type {
  CorpusRevisionId,
  NormalizedObservation,
  ObservationRepository,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey } from '@bb/domain';

/**
 * Append-only NormalizedObservation store (understanding.normalized_observation). Business-scoped;
 * observations are never overwritten. `listByCorpus` returns observations in the corpus's recorded
 * (source) order.
 */
export class PgObservationRepository implements ObservationRepository {
  constructor(private readonly db: KyselyDB) {}

  async appendMany(businessRef: SubjectRef, observations: readonly NormalizedObservation[]): Promise<void> {
    if (observations.length === 0) return;
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    for (const o of observations) {
      const existing = await db
        .selectFrom('understanding.normalized_observation')
        .select(['payload', 'extraction'])
        .where('business_ref', '=', brk)
        .where('id', '=', o.id)
        .executeTakeFirst();
      if (existing) {
        const storedPayload = typeof existing.payload === 'string' ? existing.payload : JSON.stringify(existing.payload);
        if (storedPayload !== JSON.stringify(o.payload)) {
          throw new Error(`observation content conflict for id ${o.id} (business ${brk})`);
        }
        continue;
      }
      await db
        .insertInto('understanding.normalized_observation')
        .values({
          business_ref: brk,
          id: o.id,
          raw_capture_id: o.rawCaptureId,
          kind: o.kind,
          payload: JSON.stringify(o.payload),
          extraction: JSON.stringify(o.extraction),
          captured_at: o.capturedAt,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onConflict((oc: any) => oc.columns(['business_ref', 'id']).doNothing())
        .execute();
    }
  }

  async listByCorpus(businessRef: SubjectRef, corpus: CorpusRevisionId): Promise<readonly NormalizedObservation[]> {
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    const rev = await db
      .selectFrom('understanding.corpus_revision')
      .select(['observation_ids'])
      .where('business_ref', '=', brk)
      .where('id', '=', corpus)
      .executeTakeFirst();
    if (!rev) return [];
    const ids = (typeof rev.observation_ids === 'string' ? JSON.parse(rev.observation_ids) : rev.observation_ids) as string[];
    if (ids.length === 0) return [];
    const rows = (await db
      .selectFrom('understanding.normalized_observation')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('id', 'in', ids)
      .execute()) as unknown[];
    const byId = new Map<string, NormalizedObservation>();
    for (const r of rows) {
      const o = toDomain(r);
      byId.set(o.id, o);
    }
    return ids.map((id) => byId.get(id)).filter((o): o is NormalizedObservation => o !== undefined);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDomain(row: any): NormalizedObservation {
  return {
    id: row.id,
    rawCaptureId: row.raw_capture_id,
    kind: row.kind,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    extraction: typeof row.extraction === 'string' ? JSON.parse(row.extraction) : row.extraction,
    capturedAt: typeof row.captured_at === 'string' ? row.captured_at : new Date(row.captured_at).toISOString(),
  };
}
