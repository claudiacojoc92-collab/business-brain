/**
 * Shared, process-singleton Instagram connector.
 *
 * Both the Sources routes and the Business Brain connection routes must use the SAME
 * InstagramConnector instance, because the CSRF `state` created at /connect is held in the
 * connector's PendingStore (Redis when REDIS_URL is set, in-memory otherwise) and consumed at /callback. Two separate instances
 * would not share that store and every callback would fail with "invalid or expired OAuth state".
 *
 * Built lazily from env; returns null when Instagram is not configured (callers send 503).
 */
import { createKyselyClient, FieldEncryptor, createRedisClient } from '@bb/infrastructure';
import { PgCredentialStore } from '../../auth/pg-credential-store';
import { InMemoryPendingStore, RedisPendingStore, type PendingStore } from '../../auth/oauth';
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
  // Pending OAuth state (state→founder/returnTo binding) MUST survive the Instagram round trip across
  // API processes/replicas and restarts. In production that means Redis (shared, durable); the previous
  // in-memory Map failed when the callback landed on a different process → "invalid or expired OAuth
  // state". Fall back to in-memory only when REDIS_URL is absent (local/dev/unit tests).
  const redisUrl = process.env['REDIS_URL'];
  const pending: PendingStore = redisUrl
    ? new RedisPendingStore(createRedisClient(redisUrl), 10 * 60 * 1000, (m) => { process.stderr.write(`[ig-pending] ${m}\n`); })
    : new InMemoryPendingStore();
  cached = new InstagramConnector(store, oauth, pending);
  return cached;
}

/** Test seam: reset the singleton so a test can inject env/config. */
export function __resetInstagramConnectorForTest(): void {
  cached = undefined;
}
