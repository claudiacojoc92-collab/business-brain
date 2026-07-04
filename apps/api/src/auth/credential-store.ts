/**
 * Provider-agnostic OAuth credential store (ADR-009 authenticated infrastructure).
 *
 * SEPARABILITY (ADR-009 Invariant 6): this interface is deliberately NOT Google-shaped. It
 * speaks only generic OAuth — a founder, a provider string, and opaque tokens. Google's OAuth
 * module depends on THIS; this depends on nothing Google. When provider #2 arrives, it reuses
 * this store with a different `provider` value and no change here. Extraction later is trivial
 * precisely because there is nothing to disentangle.
 *
 * CONTAINMENT (ADR-009 Invariant 4): the tokens carried by `StoredCredential` are secrets. They
 * are encrypted at rest by the implementation before they touch the database, and this store is
 * the ONLY plane on which a token exists. No caller logs, echoes, or forwards them into evidence,
 * provenance, or founder-facing output.
 */

/** Plaintext credential as held transiently in memory during a flow — never persisted as-is. */
export interface StoredCredential {
  accessToken: string;
  refreshToken: string | null;
  /** access-token expiry; null when the provider did not supply one */
  expiresAt: Date | null;
  /** space-delimited granted scopes (not a secret) */
  scopes: string | null;
}

/**
 * Persistence boundary for OAuth credentials. Implementations MUST encrypt tokens at rest.
 * Keyed by (founderId, provider) so one founder can hold credentials for several providers.
 */
export interface CredentialStore {
  /** upsert the founder's credential for a provider (tokens encrypted before storage) */
  save(founderId: string, provider: string, cred: StoredCredential): Promise<void>;
  /** load + decrypt, or null if the founder has not connected this provider */
  load(founderId: string, provider: string): Promise<StoredCredential | null>;
  /** boolean presence — never returns or logs token material */
  has(founderId: string, provider: string): Promise<boolean>;
  /** revoke/disconnect: delete the founder's credential for a provider */
  delete(founderId: string, provider: string): Promise<void>;
}
