/**
 * Pg identity/session repository (S0-T2, V054). Implements IIdentityRepository:
 *  - get-or-create founder is ATOMIC (INSERT … ON CONFLICT(email) DO NOTHING; SELECT) — the UNIQUE(email)
 *    constraint guarantees the same email always resolves to the same founder_id, even under concurrency;
 *  - token consume is a single transactional UPDATE gated on used_at IS NULL AND not-expired (single-use);
 *  - session lookup slides the expiry.
 */
import { generateId } from '@bb/shared';
import { SESSION_TTL_SECONDS, type IIdentityRepository } from './session.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgIdentityRepository implements IIdentityRepository {
  constructor(private readonly db: AnyDB) {}

  async getOrCreateFounder(email: string): Promise<string> {
    await this.db
      .insertInto('identity.founders')
      .values({ founder_id: generateId(), email })
      .onConflict((oc: AnyDB) => oc.column('email').doNothing())
      .execute();
    const row = await this.db
      .selectFrom('identity.founders').select('founder_id').where('email', '=', email).executeTakeFirst();
    return row.founder_id as string;
  }

  async mintToken(tokenHash: string, email: string, expiresAt: Date): Promise<void> {
    await this.db.insertInto('identity.magic_link_tokens')
      .values({ token_hash: tokenHash, email, expires_at: expiresAt.toISOString() })
      .onConflict((oc: AnyDB) => oc.column('token_hash').doNothing())
      .execute();
  }

  async consumeToken(tokenHash: string, now: Date): Promise<string | null> {
    const row = await this.db
      .updateTable('identity.magic_link_tokens')
      .set({ used_at: now.toISOString() })
      .where('token_hash', '=', tokenHash)
      .where('used_at', 'is', null)                 // single-use
      .where('expires_at', '>', now.toISOString())  // not expired
      .returning('email')
      .executeTakeFirst();
    return row ? (row.email as string) : null;
  }

  async createSession(sessionId: string, founderId: string, expiresAt: Date): Promise<void> {
    await this.db.insertInto('identity.sessions')
      .values({ session_id: sessionId, founder_id: founderId, expires_at: expiresAt.toISOString() })
      .execute();
  }

  async lookupSession(sessionId: string, now: Date): Promise<string | null> {
    const slid = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
    const row = await this.db
      .updateTable('identity.sessions')
      .set({ last_seen_at: now.toISOString(), expires_at: slid }) // slide on use
      .where('session_id', '=', sessionId)
      .where('expires_at', '>', now.toISOString())
      .returning('founder_id')
      .executeTakeFirst();
    return row ? (row.founder_id as string) : null;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.deleteFrom('identity.sessions').where('session_id', '=', sessionId).execute();
  }
}
