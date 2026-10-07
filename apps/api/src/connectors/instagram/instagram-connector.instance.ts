/**
 * Shared, process-singleton Instagram connector.
 *
 * Both the Sources routes and the Business Brain connection routes must use the SAME
 * InstagramConnector instance, because the CSRF `state` created at /connect is held in the
 * connector's in-memory PendingAuthStore and consumed at /callback. Two separate instances
 * would not share that store and every callback would fail with "invalid or expired OAuth state".
 *
 * Built lazily from env; returns null when Instagram is not configured (callers send 503).
 */
import { createKyselyClient, FieldEncryptor } from '@bb/infrastructure';
import { PgCredentialStore } from '../../auth/pg-credential-store';
import { PendingAuthStore } from '../../auth/oauth';
import { InstagramConnector } from './instagram.connector';
import type { InstagramOAuthConfig } from './instagram-oauth';

let cached: InstagramConnector | null | undefined;

export function getInstagramConnector(): InstagramConnector | null {
  if (cached !== undefined) return cached;
  const appId = process.env['INSTAGRAM_APP_ID'] ?? '';
  const appSecret = process.env['INSTAGRAM_APP_SECRET'] ?? '';
  const encKeyHex = process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] ?? ''; // provider-agnostic key (ADR-009)
  const redirectUri = process.env['INSTAGRAM_REDIRECT_URI'] ?? 'http://localhost:3000/api/sources/instagram/callback';
  if (!(appId && appSecret && encKeyHex)) {
    cached = null;
    return null;
  }
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const store = new PgCredentialStore(db, FieldEncryptor.fromHexKey(encKeyHex));
  const oauth: InstagramOAuthConfig = { appId, appSecret, redirectUri };
  cached = new InstagramConnector(store, oauth, new PendingAuthStore());
  return cached;
}

/** Test seam: reset the singleton so a test can inject env/config. */
export function __resetInstagramConnectorForTest(): void {
  cached = undefined;
}
