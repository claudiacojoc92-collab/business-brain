import type { KyselyDB } from '../client';
import type { IBusinessRepository, CreateBusinessRow, BusinessRecord } from '@bb/application';
import { coerceLocale } from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */

function toRecord(row: any): BusinessRecord {
  return {
    id: row.id,
    name: row.name,
    ownerFounderId: row.owner_founder_id,
    defaultConversationLanguage: coerceLocale(row.default_conversation_language),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/**
 * workspace.businesses + workspace.memberships persistence (Slice 0).
 * Reads are membership-filtered (authoritative authorization; RLS is defense-in-depth).
 */
export class PgBusinessRepository implements IBusinessRepository {
  constructor(private readonly db: KyselyDB) {}

  async createWithOwnerMembership(row: CreateBusinessRow): Promise<BusinessRecord> {
    const created = await (this.db as any).transaction().execute(async (trx: any) => {
      const business = await trx
        .insertInto('workspace.businesses')
        .values({
          id: row.id,
          owner_founder_id: row.ownerFounderId,
          name: row.name,
          default_conversation_language: row.defaultConversationLanguage,
        })
        .returning(['id', 'name', 'owner_founder_id', 'default_conversation_language', 'created_at'])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('workspace.memberships')
        .values({
          id: row.membershipId,
          business_id: row.id,
          founder_id: row.ownerFounderId,
          role: 'owner',
        })
        .execute();

      return business;
    });
    return toRecord(created);
  }

  async listForFounder(founderId: string): Promise<BusinessRecord[]> {
    const rows = await (this.db as any)
      .selectFrom('workspace.businesses as b')
      .innerJoin('workspace.memberships as m', 'm.business_id', 'b.id')
      .select(['b.id', 'b.name', 'b.owner_founder_id', 'b.default_conversation_language', 'b.created_at'])
      .where('m.founder_id', '=', founderId)
      .where('b.deleted_at', 'is', null)
      .orderBy('b.created_at', 'desc')
      .execute();
    return rows.map(toRecord);
  }

  async getForFounder(businessId: string, founderId: string): Promise<BusinessRecord | null> {
    const row = await (this.db as any)
      .selectFrom('workspace.businesses as b')
      .innerJoin('workspace.memberships as m', 'm.business_id', 'b.id')
      .select(['b.id', 'b.name', 'b.owner_founder_id', 'b.default_conversation_language', 'b.created_at'])
      .where('b.id', '=', businessId)
      .where('m.founder_id', '=', founderId)
      .where('b.deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async hasMembership(businessId: string, founderId: string): Promise<boolean> {
    const row = await (this.db as any)
      .selectFrom('workspace.memberships')
      .select('id')
      .where('business_id', '=', businessId)
      .where('founder_id', '=', founderId)
      .executeTakeFirst();
    return Boolean(row);
  }
}
