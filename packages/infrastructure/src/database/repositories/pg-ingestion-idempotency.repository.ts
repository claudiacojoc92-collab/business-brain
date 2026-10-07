import type { KyselyDB } from '../client';
import type { CorpusRevisionId, SubjectRef } from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import type { IngestionIdempotencyStore } from '@bb/application';

/**
 * Fixture-ingestion idempotency store (understanding.ingestion_idempotency). Business-scoped by
 * (business_ref, fixture_hash). Append-only: a repeat put is a no-op; find returns the existing revision.
 */
export class PgIngestionIdempotencyRepository implements IngestionIdempotencyStore {
  constructor(private readonly db: KyselyDB) {}

  async find(businessRef: SubjectRef, fixtureHash: string): Promise<CorpusRevisionId | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.ingestion_idempotency')
      .select(['corpus_revision_id'])
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('fixture_hash', '=', fixtureHash)
      .executeTakeFirst();
    return (row?.corpus_revision_id as CorpusRevisionId | undefined) ?? null;
  }

  async put(businessRef: SubjectRef, fixtureHash: string, corpusRevisionId: CorpusRevisionId): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any)
      .insertInto('understanding.ingestion_idempotency')
      .values({
        business_ref: businessRefKey(businessRef),
        fixture_hash: fixtureHash,
        corpus_revision_id: corpusRevisionId,
        created_at: new Date().toISOString(),
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) => oc.columns(['business_ref', 'fixture_hash']).doNothing())
      .execute();
  }
}
