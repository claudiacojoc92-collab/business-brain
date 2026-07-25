import type { KyselyDB } from '../database/client';
import type { SubjectRef } from '@bb/domain';
import type { FacetExtractionRepos, FacetExtractionUnitOfWork } from '@bb/application';
import { PgObservationRepository } from '../database/repositories/pg-observation.repository';
import { PgFacetRepository } from '../database/repositories/pg-facet.repository';
import { PgFacetExtractionRunRepository } from '../database/repositories/pg-facet-extraction-run.repository';

/**
 * Kysely-backed facet-extraction unit of work. Opens ONE transaction and hands the service tx-scoped
 * observation reads + facet appends + run-marker writes. A throw rolls the whole transaction back.
 */
export class KyselyFacetExtractionUnitOfWork implements FacetExtractionUnitOfWork {
  constructor(private readonly db: KyselyDB) {}

  async run<T>(_businessRef: SubjectRef, work: (repos: FacetExtractionRepos) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const tx = trx as unknown as KyselyDB;
      const repos: FacetExtractionRepos = {
        observations: new PgObservationRepository(tx),
        facets: new PgFacetRepository(tx),
        runs: new PgFacetExtractionRunRepository(tx),
      };
      return work(repos);
    });
  }
}
