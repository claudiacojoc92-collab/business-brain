/**
 * Postgres-backed CredentialStore. Encrypts tokens at rest with FieldEncryptor (AES-256-GCM)
 * BEFORE they touch the database; decrypts only in memory on load. The database never sees a
 * plaintext token; logs never see one either (this module never logs token material).
 *
 * This class is still provider-agnostic — it takes a `provider` argument and stores it as a
 * column. It knows nothing about Google. Google's OAuth module hands it already-obtained tokens.
 */
import { FieldEncryptor } from '@bb/infrastructure';
import type { KyselyDB } from '@bb/infrastructure';
import type { CredentialStore, StoredCredential } from './credential-store';

const TABLE = 'app.oauth_credentials';

export class PgCredentialStore implements CredentialStore {
  constructor(
    private readonly db: KyselyDB,
    private readonly encryptor: FieldEncryptor,
  ) {}

  async save(founderId: string, provider: string, cred: StoredCredential): Promise<void> {
    const row = {
      founder_id: founderId,
      provider,
      encrypted_access_token: this.encryptor.encrypt(cred.accessToken),
      encrypted_refresh_token: cred.refreshToken ? this.encryptor.encrypt(cred.refreshToken) : null,
      token_expires_at: cred.expiresAt ? cred.expiresAt.toISOString() : null,
      scopes: cred.scopes,
      updated_at: new Date().toISOString(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any)
      .insertInto(TABLE)
      .values({ ...row, created_at: new Date().toISOString() })
      .onConflict((oc: any) =>
        oc.columns(['founder_id', 'provider']).doUpdateSet({
          encrypted_access_token: row.encrypted_access_token,
          encrypted_refresh_token: row.encrypted_refresh_token,
          token_expires_at: row.token_expires_at,
          scopes: row.scopes,
          updated_at: row.updated_at,
        }),
      )
      .execute();
  }

  async load(founderId: string, provider: string): Promise<StoredCredential | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (this.db as any)
      .selectFrom(TABLE)
      .select(['encrypted_access_token', 'encrypted_refresh_token', 'token_expires_at', 'scopes'])
      .where('founder_id', '=', founderId)
      .where('provider', '=', provider)
      .executeTakeFirst();
    if (!r) return null;
    return {
      accessToken: this.encryptor.decrypt(r.encrypted_access_token),
      refreshToken: r.encrypted_refresh_token ? this.encryptor.decrypt(r.encrypted_refresh_token) : null,
      expiresAt: r.token_expires_at ? new Date(r.token_expires_at) : null,
      scopes: r.scopes ?? null,
    };
  }

  async has(founderId: string, provider: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (this.db as any)
      .selectFrom(TABLE)
      .select(['founder_id'])
      .where('founder_id', '=', founderId)
      .where('provider', '=', provider)
      .executeTakeFirst();
    return Boolean(r);
  }

  async delete(founderId: string, provider: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any)
      .deleteFrom(TABLE)
      .where('founder_id', '=', founderId)
      .where('provider', '=', provider)
      .execute();
  }
}
