import type { KyselyDB } from '../database/client';
import type { SubjectRef } from '@bb/domain';
import type { ReviewRepos, ReviewUnitOfWork } from '@bb/application';
import { PgReviewRepository } from '../database/repositories/pg-review.repository';
import { PgSnapshotRepository } from '../database/repositories/pg-snapshot.repository';

/**
 * Kysely-backed review unit of work. Opens ONE transaction so append_seq allocation and the review insert
 * are atomic, and binds the snapshot repository to the SAME transaction for referential validation (read)
 * at the moment of append. A throw rolls the whole transaction back.
 */
export class KyselyReviewUnitOfWork implements ReviewUnitOfWork {
  constructor(private readonly db: KyselyDB) {}

  async run<T>(_businessRef: SubjectRef, work: (repos: ReviewRepos) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const bound = trx as unknown as KyselyDB;
      return work({
        reviews: new PgReviewRepository(bound),
        snapshots: new PgSnapshotRepository(bound),
      });
    });
  }
}
