-- V055: Business Read persistence (S1-T3). Immutable, founder-scoped snapshots of a fully-assembled,
-- receipt-bearing Business Read (S1-T1 assembler + S1-T2 receipts). Additive after V054; touches no
-- existing table.
--
-- Option A (whole-snapshot JSONB): the ENTIRE resolved Read is stored as one document so a historical Read
-- reloads exactly as the founder saw it, even after sources change/revoke/disconnect, assembler mappings
-- evolve, recommendation logic changes, or language evolves. Reassembling on fetch would drift; normalized
-- rows would couple history to the current schema. Immutability is the point — one row per generated Read,
-- never updated in place; a correction is a NEW row.
--
-- founder_id is bare TEXT with NO FK, matching the nucleus convention (V050 evidence, V051 oauth, V052
-- threads, V053 recommendations): the dev founder id is a plain string and the identity root carries no
-- cascade, so removal is the EXPLICIT ordered delete in account deletion (S0-T4). A FK+CASCADE here would
-- both break that convention and fail on the DEV_FOUNDER_ID orphan (data present, no identity.founders row).

CREATE SCHEMA IF NOT EXISTS business_read;

CREATE TABLE IF NOT EXISTS business_read.snapshots (
  read_id        TEXT        PRIMARY KEY,                 -- ULID (generateId()), matches identity.founders
  founder_id     TEXT        NOT NULL,                    -- bare, app-scoped (no FK) — see header
  schema_version INT         NOT NULL DEFAULT 1,          -- the BusinessRead contract version
  content_hash   TEXT        NOT NULL,                    -- sha256 of canonicalize(read_content), round-trip stable
  read_content   JSONB       NOT NULL,                    -- the WHOLE resolved BusinessRead (Option A)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_read_founder_created
  ON business_read.snapshots (founder_id, created_at DESC, read_id);

COMMENT ON TABLE business_read.snapshots IS
  'Immutable Business Read snapshots (S1-T3). One row per generated Read; never updated in place (a correction is a new row). read_content is the whole assembled + receipt-bearing BusinessRead. founder_id is bare TEXT (no FK); removed by the explicit ordered delete in account deletion.';
