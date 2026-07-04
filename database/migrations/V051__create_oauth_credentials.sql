-- V051: Authenticated Sources — provider-agnostic OAuth credential store (ADR-009).
--
-- The minimal authenticated infrastructure ADR-009 Invariant 6 approves: built together with
-- Google as the first proving provider, but deliberately NOT Google-shaped, so it can be
-- extracted unchanged when provider #2 (Notion, etc.) arrives. `provider` is a column, not a
-- table name; every column here is generic OAuth (token, refresh, expiry, scope). Nothing in
-- this schema references Google.
--
-- Credential containment (ADR-009 Invariant 4): tokens are ACCESS, never information. They are
-- stored ENCRYPTED AT REST (AES-256-GCM, application layer) and live only here — never in
-- evidence, provenance, founder-facing output, or logs. This table is the sole plane on which
-- a credential exists.
--
-- founder_id is TEXT (no FK) to match the evidence store's precedent (V050): the dev founder id
-- is a plain string, and coupling this generic store to the founder table would fight the
-- separability the ADR requires. Reversible default; a FK can be added later if warranted.

CREATE TABLE IF NOT EXISTS app.oauth_credentials (
  founder_id                TEXT        NOT NULL,
  provider                  TEXT        NOT NULL,          -- 'google' today; generic by design
  encrypted_access_token    TEXT        NOT NULL,          -- AES-256-GCM ciphertext (base64), never plaintext
  encrypted_refresh_token   TEXT,                          -- nullable: not every grant returns a refresh token
  token_expires_at          TIMESTAMPTZ,                   -- access-token expiry (drives ahead-of-expiry refresh)
  scopes                    TEXT,                          -- space-delimited granted scopes (not a secret)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (founder_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_oauth_credentials_founder
  ON app.oauth_credentials (founder_id);
