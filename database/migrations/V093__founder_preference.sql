-- V093: Founder preferences — the minimum sound language system (Phase 1). Stores the founder's active language so Business
-- Brain can respond in it (no mixing Romanian input with English output) and the UI can default coherently. One row per
-- founder; mutable (upsert). Not append-only — a preference is current state, not a ledger. Forward-only.

CREATE TABLE IF NOT EXISTS business.founder_preference (
  founder_id  TEXT        PRIMARY KEY,
  language    TEXT        NOT NULL DEFAULT 'en',   -- BCP-47-ish short code: 'en', 'ro', …
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE business.founder_preference IS 'Founder preferences (Phase 1: active language). Current-state, upsert; not append-only.';
