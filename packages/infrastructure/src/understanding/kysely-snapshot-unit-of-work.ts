import type { KyselyDB } from '../database/client';
import type { SubjectRef, SnapshotRepository } from '@bb/domain';
import type { SnapshotUnitOfWork } from '@bb/application';
import { PgSnapshotRepository } from '../database/repositories/pg-snapshot.repository';

/**
 * Kysely-backed snapshot unit of work. Opens ONE transaction so the version row and all its statement
 * child rows are written atomically. A throw rolls the whole transaction back.
 */
export class KyselySnapshotUnitOfWork implements SnapshotUnitOfWork {
  constructor(private readonly db: KyselyDB) {}

  async run<T>(_businessRef: SubjectRef, work: (snapshots: SnapshotRepository) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      return work(new PgSnapshotRepository(trx as unknown as KyselyDB));
    });
  }
}
