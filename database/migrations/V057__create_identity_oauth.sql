-- V057: Federated LOGIN identities (A–E Wave 1). "Continue with Google" — and, architecturally, Apple /
-- Microsoft later (the `provider` column accommodates them; no code for those in Wave 1). A provider's
-- stable subject (sub) maps to a founder_id, so returning founders resolve to the SAME identity. This is
-- LOGIN ONLY and is deliberately SEPARATE from app.oauth_credentials, which holds business-SOURCE access
-- tokens (Analytics/Drive/etc.). Login ≠ source authorization. No FK cascade (manual delete in delete.service).

CREATE TABLE IF NOT EXISTS identity.oauth_identities (
  id           TEXT        PRIMARY KEY,                      -- ULID
  founder_id   TEXT        NOT NULL,                         -- the resolved root identity
  provider     TEXT        NOT NULL,                         -- 'google' (future: 'apple','microsoft')
  subject      TEXT        NOT NULL,                         -- provider-stable user id (sub); never the email
  email        TEXT,                                         -- provider-reported email at link time (informational)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)                                 -- one founder per (provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_oauth_identities_founder ON identity.oauth_identities (founder_id);

COMMENT ON TABLE identity.oauth_identities IS
  'Federated LOGIN identities (Wave 1: Google). (provider, subject) → stable founder_id. Login only — NOT source access (that is app.oauth_credentials).';
