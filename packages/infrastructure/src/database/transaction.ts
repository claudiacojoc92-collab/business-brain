import { sql } from 'kysely';
import type { ITransactionManager } from '@bb/application';
import type { KyselyDB } from './client';

/**
 * Kysely-backed transaction manager.
 * Implements ITransactionManager from the application layer.
 *
 * RULE: Every transaction sets the RLS context via setRlsContext()
 * before executing the work function.
 *
 * Source: Implementation Spec V1 Section 03.
 */
export class KyselyTransactionManager implements ITransactionManager {
  constructor(
    private readonly db: KyselyDB,
    private readonly founderId: string,
    private readonly role: string,
    private readonly traceId: string,
  ) {}

  async run<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      // Set RLS context within transaction
      await sql`SELECT
        set_config('app.current_founder_id', ${this.founderId}, true),
        set_config('app.role',               ${this.role},      true),
        set_config('app.trace_id',           ${this.traceId},   true)
      `.execute(trx);
      return work(trx);
    });
  }
}
