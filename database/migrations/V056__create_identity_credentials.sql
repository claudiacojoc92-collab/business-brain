-- V056: Email/password credentials (A–E Wave 1 — Trust & Arrival). One credential row per founder.
-- Re-introduces password auth (retired with the M2 bridge in S0-T2) on the magic-link identity root:
-- identity.founders remains the SINGLE root identity (email → stable founder_id); this table only
-- attaches a password_hash to an existing founder_id. No FK cascade by design (the codebase deletes
-- founder-owned rows explicitly in delete.service — see V050-era convention); deletion coverage is added
-- there, not via ON DELETE. The hash is a self-describing scrypt string (alg$salt$dk); plaintext is never
-- stored, never logged. LOGIN identity only — unrelated to app.oauth_credentials (business-source access).

CREATE TABLE IF NOT EXISTS identity.founder_credentials (
  founder_id     TEXT        PRIMARY KEY,                    -- one credential per founder (no FK; manual delete)
  password_hash  TEXT        NOT NULL,                       -- scrypt: 'scrypt$<saltHex>$<dkHex>'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE identity.founder_credentials IS
  'Email/password credentials (Wave 1). One scrypt hash per founder_id on the magic-link identity root. Login only — NOT source access.';
