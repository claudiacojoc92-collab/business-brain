import type { KyselyDB } from '../database/client';
import type { SubjectRef } from '@bb/domain';
import type { DeclarationRepos, DeclarationUnitOfWork } from '@bb/application';
import { PgDeclarationRepository } from '../database/repositories/pg-declaration.repository';

/**
 * Kysely-backed declaration unit of work. Opens ONE transaction so append_seq allocation and the
 * declaration insert are atomic. A throw rolls the whole transaction back. Business-scoped — no snapshot
 * repository is bound, because a declaration references no snapshot.
 */
export class KyselyDeclarationUnitOfWork implements DeclarationUnitOfWork {
  constructor(private readonly db: KyselyDB) {}

  async run<T>(_businessRef: SubjectRef, work: (repos: DeclarationRepos) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      return work({ declarations: new PgDeclarationRepository(trx as unknown as KyselyDB) });
    });
  }
}
