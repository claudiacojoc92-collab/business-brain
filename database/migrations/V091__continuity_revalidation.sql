-- V091: Legible continuity + context revalidation. Two append-only relations that make accumulated Understanding legible and
-- trustworthy at the moment Business Brain reasons with it — without mutating the immutable clarity_result (the continuity
-- SNAPSHOT lives in clarity_result.payload; these tables are the durable id-linkage and the founder's revalidation history).
--
--   * clarity_context_use — which exact Understanding items MATERIALLY informed each clarity_result. Append-only; proves
--     continuity, supports transparency/explainability/debugging. Never invented: the service writes only items it supplied.
--   * understanding_revalidation — the founder's lightweight revalidation events on an Understanding item ('confirmed' the
--     item is still true, or 'unsure'). A 'confirmed' event updates the derived last-confirmed time WITHOUT creating a
--     duplicate item; 'unsure' preserves uncertainty. "This has changed" is NOT here — it is a founder correction
--     (understanding_item supersession, V090), so history and authorship stay intact.
--
-- Founder-scoped. Forward-only; edits no earlier migration.

CREATE TABLE IF NOT EXISTS business.clarity_context_use (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  clarity_result_id     TEXT        NOT NULL REFERENCES business.clarity_result(id),
  understanding_item_id TEXT        NOT NULL REFERENCES business.understanding_item(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ccu_founder ON business.clarity_context_use (founder_id);
CREATE INDEX IF NOT EXISTS idx_ccu_result ON business.clarity_context_use (clarity_result_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ccu_result_item ON business.clarity_context_use (clarity_result_id, understanding_item_id);

CREATE OR REPLACE FUNCTION business.ccu_forbid_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'clarity_context_use is append-only: UPDATE is forbidden'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ccu_no_update ON business.clarity_context_use;
CREATE TRIGGER ccu_no_update BEFORE UPDATE ON business.clarity_context_use FOR EACH ROW EXECUTE FUNCTION business.ccu_forbid_update();
CREATE OR REPLACE FUNCTION business.ccu_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_concern_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'clarity_context_use is append-only: individual DELETE forbidden (only founder-account deletion may remove it)';
  END IF; RETURN OLD;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ccu_no_delete ON business.clarity_context_use;
CREATE TRIGGER ccu_no_delete BEFORE DELETE ON business.clarity_context_use FOR EACH ROW EXECUTE FUNCTION business.ccu_forbid_delete();

CREATE TABLE IF NOT EXISTS business.understanding_revalidation (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  understanding_item_id TEXT        NOT NULL REFERENCES business.understanding_item(id),
  outcome               TEXT        NOT NULL,   -- confirmed | unsure  ("changed" is a correction, not a revalidation)
  source_concern_id     TEXT,                   -- the concern the revalidation happened in (nullable)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ur_outcome_enum') THEN
    ALTER TABLE business.understanding_revalidation ADD CONSTRAINT ur_outcome_enum CHECK (outcome IN ('confirmed','unsure'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ur_founder ON business.understanding_revalidation (founder_id);
CREATE INDEX IF NOT EXISTS idx_ur_item ON business.understanding_revalidation (understanding_item_id, created_at DESC);

CREATE OR REPLACE FUNCTION business.ur_forbid_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'understanding_revalidation is append-only: UPDATE is forbidden (a later revalidation is a new event)'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ur_no_update ON business.understanding_revalidation;
CREATE TRIGGER ur_no_update BEFORE UPDATE ON business.understanding_revalidation FOR EACH ROW EXECUTE FUNCTION business.ur_forbid_update();
CREATE OR REPLACE FUNCTION business.ur_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_understanding_item_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'understanding_revalidation is append-only: individual DELETE forbidden (only founder-account deletion may remove it)';
  END IF; RETURN OLD;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ur_no_delete ON business.understanding_revalidation;
CREATE TRIGGER ur_no_delete BEFORE DELETE ON business.understanding_revalidation FOR EACH ROW EXECUTE FUNCTION business.ur_forbid_delete();

COMMENT ON TABLE business.clarity_context_use IS 'Append-only: which Understanding items materially informed each clarity_result. Durable continuity linkage (transparency/explainability). Never invented — the service writes only supplied items.';
COMMENT ON TABLE business.understanding_revalidation IS 'Append-only founder revalidation events on an Understanding item (confirmed still-true, or unsure). A confirmed event updates the derived last-confirmed time without creating a duplicate item. "Changed" is a correction (understanding_item supersession), not recorded here.';
