import type { KyselyDB } from '../client';
import type { IFounderAuthRepository } from '@bb/application';
import type { AuthenticateFounderResult } from '@bb/application';

/**
 * Reads from app.founder_auth joined to founder.founders by email.
 * Used only by the AuthenticateFounder query handler.
 */
export class PgFounderAuthRepository implements IFounderAuthRepository {
  constructor(private readonly db: KyselyDB) {}

  async findByEmail(email: string): Promise<AuthenticateFounderResult | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('app.founder_auth as fa')
      .innerJoin('founder.founders as f', 'f.id', 'fa.founder_id')
      .select(['f.id as founderId', 'fa.password_hash as passwordHash'])
      .where('f.email', '=', email)
      .where('f.deleted_at', 'is', null)
      .executeTakeFirst();

    if (!row) return null;
    return { founderId: row.founderId, passwordHash: row.passwordHash };
  }
}
