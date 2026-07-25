import type { KyselyDB } from '../database/client';
import type { SubjectRef } from '@bb/domain';
import type { PresentationRepos, PresentationUnitOfWork } from '@bb/application';
import { PgPresentedEventRepository } from '../database/repositories/pg-presented-event.repository';
import { PgSnapshotRepository } from '../database/repositories/pg-snapshot.repository';

/**
 * Kysely-backed presentation unit of work. Opens ONE transaction so append_seq allocation and the event
 * insert are atomic, and binds the snapshot repository to the SAME transaction for referential validation
 * (read) at the moment of append. A throw rolls the whole transaction back.
 */
export class KyselyPresentationUnitOfWork implements PresentationUnitOfWork {
  constructor(private readonly db: KyselyDB) {}

  async run<T>(_businessRef: SubjectRef, work: (repos: PresentationRepos) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const bound = trx as unknown as KyselyDB;
      return work({
        presentations: new PgPresentedEventRepository(bound),
        snapshots: new PgSnapshotRepository(bound),
      });
    });
  }
}
