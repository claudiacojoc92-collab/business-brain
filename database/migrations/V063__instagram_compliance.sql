-- V063: Instagram compliance (Meta App Review) — Deauthorize + Data-Deletion support.
--
-- Two additive tables, both self-contained (no new dependencies beyond founder.founders, already present):
--
-- 1. bb_instagram_identity — maps the app-scoped Instagram user id (from the OAuth token exchange and
--    from Meta's signed_request) to our founder. Recorded at OAuth callback so a Deauthorize or
--    Data-Deletion callback — which carries ONLY the ig user id, never a founder token — can find and
--    purge the right founder's Instagram data even if they never generated a Business Brain.
--    The ig user id is app-scoped and not personal content; no tokens or captions are stored here.
--
-- 2. bb_deletion_request — an auditable, idempotent ledger of Deauthorize / Data-Deletion requests,
--    keyed by a deterministic public confirmation_code. Powers the public deletion-status page.
--    Stores NO personal content and NO secrets — only the app-scoped ig user id, the founder id,
--    the request kind, and the status timestamps.

CREATE TABLE IF NOT EXISTS businessbrain.bb_instagram_identity (
  ig_user_id   TEXT        NOT NULL PRIMARY KEY,   -- app-scoped Instagram user id (not secret, not personal content)
  founder_id   TEXT        NOT NULL REFERENCES founder.founders(id) ON DELETE CASCADE,
  connected_at TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS bb_ig_identity_founder_idx ON businessbrain.bb_instagram_identity (founder_id);

CREATE TABLE IF NOT EXISTS businessbrain.bb_deletion_request (
  confirmation_code TEXT        NOT NULL PRIMARY KEY,   -- deterministic, public, non-reversible (sha256-derived)
  kind              TEXT        NOT NULL,               -- 'deauthorize' | 'data_deletion'
  ig_user_id        TEXT,                               -- app-scoped id (nullable if signature had none)
  founder_id        TEXT,                               -- resolved founder (nullable if no match)
  status            TEXT        NOT NULL,               -- 'received' | 'completed'
  requested_at      TIMESTAMPTZ NOT NULL,
  completed_at      TIMESTAMPTZ,
  CONSTRAINT bb_del_kind_valid   CHECK (kind   IN ('deauthorize', 'data_deletion')),
  CONSTRAINT bb_del_status_valid CHECK (status IN ('received', 'completed'))
);
CREATE INDEX IF NOT EXISTS bb_deletion_ig_idx ON businessbrain.bb_deletion_request (ig_user_id);
