-- V061: Business Brain V1 — additive API support (Phase 6).
--
-- Two small additive tables in the existing `businessbrain` schema. Does NOT alter V060.
--
--  1. bb_start_refresh_idempotency — persistent, reload-safe Start Refresh idempotency.
--     Maps (founder, client token) -> the accepted refresh_reference plus a request
--     fingerprint. Same token + same fingerprint replays the same accepted operation;
--     same token + different fingerprint is an IDEMPOTENCY_CONFLICT. Content-free.
--
--  2. bb_dev_connection — DEVELOPMENT Instagram connection adapter (NOT real OAuth).
--     Gives Start Refresh a connected/not_connected gate and lets Disconnect reconcile
--     an active Refresh, without implementing Instagram OAuth in this increment. The
--     public Connection Status contract is served from this; its development nature is
--     explicit here and in the adapter.

CREATE TABLE IF NOT EXISTS businessbrain.bb_start_refresh_idempotency (
  founder_id          TEXT        NOT NULL REFERENCES founder.founders(id) ON DELETE CASCADE,
  token               TEXT        NOT NULL,
  refresh_reference   TEXT        NOT NULL,
  request_fingerprint TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (founder_id, token)
);

CREATE TABLE IF NOT EXISTS businessbrain.bb_dev_connection (
  founder_id   TEXT        NOT NULL PRIMARY KEY REFERENCES founder.founders(id) ON DELETE CASCADE,
  state        TEXT        NOT NULL,
  connected_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL,
  CONSTRAINT bb_dev_connection_state_valid CHECK (state IN ('not_connected', 'connected', 'revoked'))
);

COMMENT ON TABLE businessbrain.bb_dev_connection IS
  'DEVELOPMENT Instagram connection adapter for the V1 slice — NOT real Instagram OAuth. Provides the connected/not_connected gate for Start Refresh. Replace with the real authenticated Source before production Instagram use.';
