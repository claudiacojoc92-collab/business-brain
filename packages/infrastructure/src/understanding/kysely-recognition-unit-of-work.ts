import type { KyselyDB } from '../database/client';
import type { SubjectRef } from '@bb/domain';
import type { RecognitionRepos, RecognitionUnitOfWork } from '@bb/application';
import { PgRecognitionEventRepository } from '../database/repositories/pg-recognition-event.repository';
import { PgSnapshotRepository } from '../database/repositories/pg-snapshot.repository';

/**
 * Kysely-backed recognition unit of work. Opens ONE transaction so append_seq allocation and the event
 * insert are atomic, and binds the snapshot repository to the SAME transaction for referential
 * validation (read) at the moment of append. A throw rolls the whole transaction back.
 */
export class KyselyRecognitionUnitOfWork implements RecognitionUnitOfWork {
  constructor(private readonly db: KyselyDB) {}

  async run<T>(_businessRef: SubjectRef, work: (repos: RecognitionRepos) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const bound = trx as unknown as KyselyDB;
      return work({
        recognition: new PgRecognitionEventRepository(bound),
        snapshots: new PgSnapshotRepository(bound),
      });
    });
  }
}
