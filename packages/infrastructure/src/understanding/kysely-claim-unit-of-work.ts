import type { KyselyDB } from '../database/client';
import type { SubjectRef } from '@bb/domain';
import type { ClaimRepos, ClaimUnitOfWork } from '@bb/application';
import { PgClaimRepository } from '../database/repositories/pg-claim.repository';

/**
 * Kysely-backed claim unit of work. Opens ONE transaction so append_seq allocation and the claim insert are
 * atomic. A throw rolls the whole transaction back. Business-scoped — no snapshot repository is bound,
 * because a claim references no snapshot.
 */
export class KyselyClaimUnitOfWork implements ClaimUnitOfWork {
  constructor(private readonly db: KyselyDB) {}

  async run<T>(_businessRef: SubjectRef, work: (repos: ClaimRepos) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      return work({ claims: new PgClaimRepository(trx as unknown as KyselyDB) });
    });
  }
}
