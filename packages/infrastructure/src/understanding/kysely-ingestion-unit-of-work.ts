import type { KyselyDB } from '../database/client';
import type { SubjectRef } from '@bb/domain';
import type { IngestionRepos, IngestionUnitOfWork } from '@bb/application';
import { PgRawCaptureRepository } from '../database/repositories/pg-raw-capture.repository';
import { PgObservationRepository } from '../database/repositories/pg-observation.repository';
import { PgUnderstandingRevisionRepository } from '../database/repositories/pg-understanding-revision.repository';
import { PgIngestionIdempotencyRepository } from '../database/repositories/pg-ingestion-idempotency.repository';

/**
 * Kysely-backed ingestion unit of work. Opens ONE database transaction and hands the service a set of
 * tx-scoped repositories. If `work` throws, the transaction rolls back and none of the writes survive.
 */
export class KyselyIngestionUnitOfWork implements IngestionUnitOfWork {
  constructor(private readonly db: KyselyDB) {}

  async run<T>(_businessRef: SubjectRef, work: (repos: IngestionRepos) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const tx = trx as unknown as KyselyDB;
      const repos: IngestionRepos = {
        rawCaptures: new PgRawCaptureRepository(tx),
        observations: new PgObservationRepository(tx),
        revisions: new PgUnderstandingRevisionRepository(tx),
        idempotency: new PgIngestionIdempotencyRepository(tx),
      };
      return work(repos);
    });
  }
}
