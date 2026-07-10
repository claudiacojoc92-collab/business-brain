-- V054: Magic-link self-serve session (S0-T2). Replaces the M2 password/JWT auth bridge with a
-- minimal identity + session model. Additive (after V053); touches no existing table.
--
-- identity.founders is the SINGLE ROOT IDENTITY: email → a stable founder_id (ULID). The nucleus
-- (evidence.fragments, memory.threads, memory.recommendations) already keys on founder_id — this table
-- just PRODUCES a stable one. UNIQUE(email) guarantees the same email always maps to the same founder_id
-- (no duplicate-founder / evidence-loss). Email is normalized (trim + lowercase) in the application.

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.founders (
  founder_id  TEXT        PRIMARY KEY,               -- ULID
  email       TEXT        NOT NULL UNIQUE,           -- normalized (trim + lowercase) in the app
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Magic-link tokens: the opaque token is emailed; only its SHA-256 HASH is stored (plaintext never
-- persisted). Single-use is enforced by setting used_at transactionally on consume. Short TTL.
CREATE TABLE IF NOT EXISTS identity.magic_link_tokens (
  token_hash  TEXT        PRIMARY KEY,               -- sha256(hex) of the opaque token
  email       TEXT        NOT NULL,                  -- normalized
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ                            -- NULL until consumed (single-use)
);
CREATE INDEX IF NOT EXISTS idx_magic_link_email ON identity.magic_link_tokens (email);

-- Server-side sessions: opaque >=256-bit session_id (server-generated, never client-supplied), revocable
-- (logout deletes the row), sliding expiry (last_seen_at/expires_at bumped on use).
CREATE TABLE IF NOT EXISTS identity.sessions (
  session_id    TEXT        PRIMARY KEY,
  founder_id    TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_founder ON identity.sessions (founder_id);

COMMENT ON TABLE identity.founders IS
  'Single root identity (S0-T2): email → stable founder_id (ULID). UNIQUE(email) ⇒ same email always maps to the same founder_id. The nucleus keys on founder_id; this only produces it.';
