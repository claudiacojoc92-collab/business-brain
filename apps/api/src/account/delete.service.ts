import { FieldEncryptor } from '@bb/infrastructure';
import { PgCredentialStore } from '../auth/pg-credential-store';
import { GoogleConnector } from '../connectors/google/google.connector';
import { PendingAuthStore } from '../auth/oauth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

/**
 * Permanent account deletion (S0-T4, Article XIII — "permanently remove"). ONE atomic transaction, HARD
 * delete, explicit ordered deletes (no cascade from the identity root — the nucleus tables carry a bare
 * founder_id with no FK, by design). Any failure rolls the whole thing back: a partial delete leaving
 * orphaned fragments is worse than none. Idempotent — deleting an already-deleted founder is a safe no-op.
 *
 * Delete order (identity-space only; M2 tables key to the DISJOINT founder.founders space and hold no rows
 * for a magic-link founder; app.domain_events has no founder_id and app.idempotency_keys is never written
 * by S0 code — all excluded, verified S0-T4 C2). magic_link_tokens key by EMAIL, so the email is read first.
 */
export async function deleteFounderAccount(
  founderId: string,
  db: AnyDB,
  opts: { failBeforeRootDelete?: () => Promise<void> } = {}, // test seam only; prod passes nothing
): Promise<{ deleted: boolean }> {
  return db.transaction().execute(async (tx: AnyDB) => {
    const founder = await tx.selectFrom('identity.founders').select(['email']).where('founder_id', '=', founderId).executeTakeFirst();
    if (!founder) return { deleted: false }; // unknown / already-deleted → idempotent no-op success
    const email = founder.email as string;

    await tx.deleteFrom('evidence.fragments').where('founder_id', '=', founderId).execute();
    await tx.deleteFrom('app.oauth_credentials').where('founder_id', '=', founderId).execute(); // destroys encrypted tokens
    await tx.deleteFrom('memory.thread_events').where('founder_id', '=', founderId).execute();
    await tx.deleteFrom('memory.threads').where('founder_id', '=', founderId).execute();
    await tx.deleteFrom('memory.recommendations').where('founder_id', '=', founderId).execute();
    await tx.deleteFrom('identity.sessions').where('founder_id', '=', founderId).execute();     // revokes all sessions
    await tx.deleteFrom('identity.magic_link_tokens').where('email', '=', email).execute();

    if (opts.failBeforeRootDelete) await opts.failBeforeRootDelete(); // atomicity test: throw here ⇒ full rollback

    await tx.deleteFrom('identity.founders').where('founder_id', '=', founderId).execute();      // root, last
    return { deleted: true };
  });
}

/**
 * Best-effort: revoke the founder's Google token UPSTREAM at Google before the local deletion, so the
 * refresh token is invalidated there too — not merely erased locally. ANY failure is swallowed; it must
 * NEVER block the local deletion (which is authoritative and destroys the encrypted token regardless).
 * No-op when Google OAuth is not configured or the founder has no google credential.
 */
export async function bestEffortGoogleRevoke(founderId: string, db: AnyDB): Promise<void> {
  try {
    const clientId = process.env['GOOGLE_CLIENT_ID'] ?? '';
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET'] ?? '';
    const encKeyHex = process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] ?? '';
    if (!clientId || !clientSecret || !encKeyHex) return; // not configured → cannot revoke upstream; local delete still erases it
    const has = await db.selectFrom('app.oauth_credentials').select(['founder_id']).where('founder_id', '=', founderId).where('provider', '=', 'google').executeTakeFirst();
    if (!has) return;
    const store = new PgCredentialStore(db, FieldEncryptor.fromHexKey(encKeyHex));
    const oauth = { clientId, clientSecret, redirectUri: process.env['GOOGLE_REDIRECT_URI'] ?? 'http://localhost:3000/dev/google/callback' };
    // No evidence repo wired → disconnect() only revokes at Google + deletes the local credential (best effort).
    await new GoogleConnector(store, oauth, new PendingAuthStore()).disconnect(founderId);
  } catch { /* swallow — local deletion is authoritative */ }
}
