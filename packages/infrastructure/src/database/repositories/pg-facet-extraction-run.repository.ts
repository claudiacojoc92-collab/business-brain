import type { KyselyDB } from '../client';
import type { CorpusRevisionId, SubjectRef } from '@bb/domain';
import { businessRefKey } from '@bb/domain';
import type { FacetExtractionRunStore } from '@bb/application';

/**
 * Extraction-run marker store (understanding.facet_extraction_run). Records that a (business, corpus,
 * profile) triple was extracted, so a repeat is detected as a replay. Append-only; keyed
 * (business_ref, corpus_revision_id, extraction_profile).
 */
export class PgFacetExtractionRunRepository implements FacetExtractionRunStore {
  constructor(private readonly db: KyselyDB) {}

  async find(businessRef: SubjectRef, corpus: CorpusRevisionId, profile: string): Promise<{ facetCount: number } | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('understanding.facet_extraction_run')
      .select(['facet_count'])
      .where('business_ref', '=', businessRefKey(businessRef))
      .where('corpus_revision_id', '=', corpus)
      .where('extraction_profile', '=', profile)
      .executeTakeFirst();
    return row ? { facetCount: Number(row.facet_count) } : null;
  }

  async put(
    businessRef: SubjectRef,
    corpus: CorpusRevisionId,
    profile: string,
    run: { facetCount: number; ruleVersions: Record<string, string> },
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any)
      .insertInto('understanding.facet_extraction_run')
      .values({
        business_ref: businessRefKey(businessRef),
        corpus_revision_id: corpus,
        extraction_profile: profile,
        facet_count: run.facetCount,
        rule_versions: JSON.stringify(run.ruleVersions),
        created_at: new Date().toISOString(),
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) => oc.columns(['business_ref', 'corpus_revision_id', 'extraction_profile']).doNothing())
      .execute();
  }
}
