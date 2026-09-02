import type { KyselyDB } from '../client';
import type {
  IFounderAccountRepository,
  FounderAccountRecord,
  CreateFounderAccountRow,
} from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */

function toRecord(row: any): FounderAccountRecord {
  return {
    founderId: row.id,
    email: row.email,
    name: row.name,
    interfaceLocale: row.interface_locale ?? 'en',
  };
}

/**
 * Founder ACCOUNT persistence (Slice 0): writes founder.founders + app.founder_auth directly.
 * This is the seam that makes real self-registration and Google account sign-in work; it does
 * NOT go through the legacy FounderProfile aggregate (account creation needs no business name).
 */
export class PgFounderAccountRepository implements IFounderAccountRepository {
  constructor(private readonly db: KyselyDB) {}

  async findByEmail(email: string): Promise<FounderAccountRecord | null> {
    const row = await (this.db as any)
      .selectFrom('founder.founders')
      .select(['id', 'email', 'name', 'interface_locale'])
      .where('email', '=', email)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async getById(founderId: string): Promise<FounderAccountRecord | null> {
    const row = await (this.db as any)
      .selectFrom('founder.founders')
      .select(['id', 'email', 'name', 'interface_locale'])
      .where('id', '=', founderId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async createAccount(row: CreateFounderAccountRow): Promise<FounderAccountRecord> {
    const created = await (this.db as any).transaction().execute(async (trx: any) => {
      const founder = await trx
        .insertInto('founder.founders')
        .values({
          id: row.founderId,
          email: row.email,
          name: row.name,
          interface_locale: row.interfaceLocale,
          // business_name is nullable as of V064; status/timezone/etc. use column defaults.
        })
        .returning(['id', 'email', 'name', 'interface_locale'])
        .executeTakeFirstOrThrow();

      if (row.passwordHash !== null) {
        await trx
          .insertInto('app.founder_auth')
          .values({ founder_id: row.founderId, password_hash: row.passwordHash })
          .execute();
      }

      return founder;
    });
    return toRecord(created);
  }

  async updateInterfaceLocale(founderId: string, locale: string): Promise<void> {
    await (this.db as any)
      .updateTable('founder.founders')
      .set({ interface_locale: locale })
      .where('id', '=', founderId)
      .execute();
  }
}
