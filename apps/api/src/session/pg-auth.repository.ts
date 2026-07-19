/**
 * Pg impl of IAuthRepository (Wave 1). Credentials in identity.founder_credentials (V056), federated login
 * identities in identity.oauth_identities (V057). No FK cascade by design — deletion coverage is explicit
 * in delete.service. Kept separate from PgIdentityRepository (which owns founders/tokens/sessions) so the
 * magic-link core stays untouched.
 */
import { generateId } from '@bb/shared';
import type { IAuthRepository } from './auth.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

export class PgAuthRepository implements IAuthRepository {
  constructor(private readonly db: AnyDB) {}

  async getFounderByEmail(email: string): Promise<string | null> {
    const r = await this.db.selectFrom('identity.founders').select('founder_id').where('email', '=', email).executeTakeFirst();
    return r ? (r.founder_id as string) : null;
  }

  async getCredential(founderId: string): Promise<{ passwordHash: string } | null> {
    const r = await this.db.selectFrom('identity.founder_credentials').select('password_hash').where('founder_id', '=', founderId).executeTakeFirst();
    return r ? { passwordHash: r.password_hash as string } : null;
  }

  async setCredential(founderId: string, passwordHash: string, now: Date): Promise<void> {
    await this.db.insertInto('identity.founder_credentials')
      .values({ founder_id: founderId, password_hash: passwordHash, created_at: now.toISOString(), updated_at: now.toISOString() })
      .onConflict((oc: AnyDB) => oc.column('founder_id').doUpdateSet({ password_hash: passwordHash, updated_at: now.toISOString() }))
      .execute();
  }

  async findFounderByOAuth(provider: string, subject: string): Promise<string | null> {
    const r = await this.db.selectFrom('identity.oauth_identities').select('founder_id').where('provider', '=', provider).where('subject', '=', subject).executeTakeFirst();
    return r ? (r.founder_id as string) : null;
  }

  async linkOAuthIdentity(founderId: string, provider: string, subject: string, email: string | null): Promise<void> {
    await this.db.insertInto('identity.oauth_identities')
      .values({ id: generateId(), founder_id: founderId, provider, subject, email })
      .onConflict((oc: AnyDB) => oc.columns(['provider', 'subject']).doNothing())
      .execute();
  }
}
