-- V068: Founder Strategic Context — enforce APPEND-ONLY history (Wave 4 slice-1 remediation).
-- The V067 model mutated the prior row's `status` on revise (ACTIVE->SUPERSEDED) and retire (ACTIVE->RETIRED),
-- which semantically rewrites historical records. This migration makes the table append-only and derives
-- effective/superseded/retired state from the immutable ordered version history instead of a mutable flag.
--
--   * `lifecycle` records what each IMMUTABLE version IS: CREATE (v1), REVISE (a new content version), or
--     RETIRE (a terminal version that ends the logical item). It is written once and never changed.
--   * Effective state is DERIVED: for a logical item, the MAX(version) row is the effective content version
--     unless its lifecycle is RETIRE (then the item is retired and has no effective version).
--   * A BEFORE UPDATE trigger forbids ANY update to the table — historical rows are physically immutable.
--     Account deletion (DELETE) remains the only destructive path. The old partial-unique index on the mutable
--     `status='ACTIVE'` is dropped; the (founder, logical_item, version) unique index is the concurrency arbiter.
--   * `status` is kept ONLY as a write-once, per-row insertion hint (never the source of truth): the repository
--     derives the authoritative status from version ordering + lifecycle and rebuilds it from the immutable rows.

ALTER TABLE business.founder_strategic_context_item ADD COLUMN IF NOT EXISTS lifecycle TEXT;

-- Backfill from the legacy status (no-op on an empty table; correct if rows exist): a RETIRED row becomes the
-- terminal RETIRE version; v1 is CREATE; every other version is a REVISE.
UPDATE business.founder_strategic_context_item
   SET lifecycle = CASE WHEN status = 'RETIRED' THEN 'RETIRE' WHEN version = 1 THEN 'CREATE' ELSE 'REVISE' END
 WHERE lifecycle IS NULL;

ALTER TABLE business.founder_strategic_context_item ALTER COLUMN lifecycle SET NOT NULL;

-- Effective state is derived from ordering now, not from a mutable ACTIVE flag → drop the old partial index.
DROP INDEX IF EXISTS business.uniq_fsc_active_per_logical;

-- APPEND-ONLY enforcement at the database: no row may ever be UPDATEd.
CREATE OR REPLACE FUNCTION business.fsc_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'founder_strategic_context_item is append-only: UPDATE is forbidden (append a new version/lifecycle row instead)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fsc_no_update ON business.founder_strategic_context_item;
CREATE TRIGGER fsc_no_update BEFORE UPDATE ON business.founder_strategic_context_item
  FOR EACH ROW EXECUTE FUNCTION business.fsc_forbid_update();

COMMENT ON COLUMN business.founder_strategic_context_item.lifecycle IS 'Immutable version kind: CREATE | REVISE | RETIRE. Effective state is derived from MAX(version) + lifecycle; no row is ever updated (append-only trigger).';
