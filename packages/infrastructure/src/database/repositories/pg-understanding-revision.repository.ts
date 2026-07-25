import type { KyselyDB } from '../client';
import type {
  CorpusRevision,
  CorpusRevisionId,
  DeclarationRevisionId,
  RevisionRepository,
  SubjectRef,
} from '@bb/domain';
import { businessRefKey, corpusRevisionId } from '@bb/domain';
import { generateId } from '@bb/shared';

const GENESIS_CORPUS: CorpusRevisionId = corpusRevisionId({ observationIds: [], activeFacetCorrectionIds: [] });
const GENESIS_CTX: DeclarationRevisionId = 'understanding_ctx_genesis';

/**
 * Named-revision store. Persists immutable corpus revisions (append-only) and maintains a
 * business-scoped pointer to the current corpus + understanding-context revision. Prior corpus
 * revisions remain readable after later ingestions. Understanding-context ops exist to satisfy the
 * port; they are not exercised by Commit 2.
 */
export class PgUnderstandingRevisionRepository implements RevisionRepository {
  constructor(private readonly db: KyselyDB) {}

  async currentCorpus(businessRef: SubjectRef): Promise<CorpusRevisionId> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.revision_pointer')
      .select(['corpus_revision_id'])
      .where('business_ref', '=', businessRefKey(businessRef))
      .executeTakeFirst();
    return (row?.corpus_revision_id as CorpusRevisionId | undefined) ?? GENESIS_CORPUS;
  }

  async currentUnderstandingCtx(businessRef: SubjectRef): Promise<DeclarationRevisionId> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.revision_pointer')
      .select(['understanding_ctx_revision_id'])
      .where('business_ref', '=', businessRefKey(businessRef))
      .executeTakeFirst();
    return (row?.understanding_ctx_revision_id as DeclarationRevisionId | undefined) ?? GENESIS_CTX;
  }

  async bumpCorpus(businessRef: SubjectRef, next: CorpusRevision): Promise<CorpusRevisionId> {
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    await db
      .insertInto('understanding.corpus_revision')
      .values({
        business_ref: brk,
        id: next.id,
        observation_ids: JSON.stringify(next.observationIds),
        active_facet_correction_ids: JSON.stringify(next.activeFacetCorrectionIds),
        created_at: next.createdAt,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) => oc.columns(['business_ref', 'id']).doNothing())
      .execute();

    const updatedAt = new Date().toISOString();
    await db
      .insertInto('understanding.revision_pointer')
      .values({ business_ref: brk, corpus_revision_id: next.id, understanding_ctx_revision_id: null, updated_at: updatedAt })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) =>
        oc.column('business_ref').doUpdateSet({ corpus_revision_id: next.id, updated_at: updatedAt }),
      )
      .execute();

    return next.id;
  }

  async bumpUnderstandingCtx(businessRef: SubjectRef): Promise<DeclarationRevisionId> {
    const brk = businessRefKey(businessRef);
    const nextCtx: DeclarationRevisionId = generateId();
    const updatedAt = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any)
      .insertInto('understanding.revision_pointer')
      .values({ business_ref: brk, corpus_revision_id: null, understanding_ctx_revision_id: nextCtx, updated_at: updatedAt })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) =>
        oc.column('business_ref').doUpdateSet({ understanding_ctx_revision_id: nextCtx, updated_at: updatedAt }),
      )
      .execute();
    return nextCtx;
  }
}
