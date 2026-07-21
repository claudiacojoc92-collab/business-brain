-- V078: Strategic Learning Lifecycle (single-thread CREATE -> REFINE/CONTEST/SUPERSEDE/RETIRE). Forward-only ALTER of
-- business.strategic_learning_record (V076/V077 NOT edited). Adds lifecycle metadata + constraints so every founder-directed
-- change appends a new immutable revision of ONE logical thread, preserving complete history. Governed by ADR-012
-- (dual-layer: single-thread lifecycle now; inter-thread relationships deferred). NO relationship table, contradiction
-- graph, similarity, or knowledge graph. Existing CREATE rows migrate with content + lineage unchanged.

-- The append-only slr_no_update trigger forbids UPDATE, so it must be dropped for the one-time backfill, then recreated.
DROP TRIGGER IF EXISTS slr_no_update ON business.strategic_learning_record;

ALTER TABLE business.strategic_learning_record
  ADD COLUMN IF NOT EXISTS lifecycle_action           TEXT,
  ADD COLUMN IF NOT EXISTS root_learning_id           TEXT,
  ADD COLUMN IF NOT EXISTS predecessor_learning_id    TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_reason           TEXT,
  ADD COLUMN IF NOT EXISTS replacement_summary        TEXT,
  ADD COLUMN IF NOT EXISTS retained_validity          TEXT,
  ADD COLUMN IF NOT EXISTS counterevidence_resolution TEXT,
  ADD COLUMN IF NOT EXISTS unknowns_resolution        TEXT;

-- One-time backfill: every existing row is an original CREATE (revision 1, its own root, no predecessor).
UPDATE business.strategic_learning_record
   SET lifecycle_action = 'CREATE', root_learning_id = id, predecessor_learning_id = NULL
 WHERE lifecycle_action IS NULL;

ALTER TABLE business.strategic_learning_record
  ALTER COLUMN lifecycle_action SET NOT NULL,
  ALTER COLUMN lifecycle_action SET DEFAULT 'CREATE',
  ALTER COLUMN root_learning_id SET NOT NULL;

-- Constraints (idempotent add-if-absent via DO blocks).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slr_revision_positive') THEN
    ALTER TABLE business.strategic_learning_record ADD CONSTRAINT slr_revision_positive CHECK (revision > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slr_lifecycle_action_enum') THEN
    ALTER TABLE business.strategic_learning_record ADD CONSTRAINT slr_lifecycle_action_enum
      CHECK (lifecycle_action IN ('CREATE','REFINE','CONTEST','SUPERSEDE','RETIRE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slr_create_shape') THEN
    ALTER TABLE business.strategic_learning_record ADD CONSTRAINT slr_create_shape CHECK (
      (lifecycle_action = 'CREATE'  AND revision = 1 AND predecessor_learning_id IS NULL) OR
      (lifecycle_action <> 'CREATE' AND revision > 1 AND predecessor_learning_id IS NOT NULL)
    );
  END IF;
END $$;

-- Contiguous, non-duplicated revisions per logical thread.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_slr_thread_revision
  ON business.strategic_learning_record (founder_id, logical_learning_id, revision);
-- No-fork: each predecessor revision is consumed by AT MOST ONE successor (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_slr_predecessor
  ON business.strategic_learning_record (founder_id, predecessor_learning_id)
  WHERE predecessor_learning_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slr_thread ON business.strategic_learning_record (founder_id, logical_learning_id);

-- Recreate the append-only UPDATE guard (unchanged).
CREATE OR REPLACE FUNCTION business.slr_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'strategic_learning_record is append-only: UPDATE is forbidden (append another revision instead)';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER slr_no_update BEFORE UPDATE ON business.strategic_learning_record
  FOR EACH ROW EXECUTE FUNCTION business.slr_forbid_update();

-- Individual-DELETE guard: reject a row DELETE unless the transaction has opted in via
-- SET LOCAL bb.allow_learning_delete = 'on' (only founder-account deletion does). Immutable history (Law 2),
-- while account deletion (Law 26) still removes all revisions with zero orphans.
CREATE OR REPLACE FUNCTION business.slr_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_learning_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'strategic_learning_record is append-only: individual DELETE is forbidden (only founder-account deletion may remove revisions)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS slr_no_delete ON business.strategic_learning_record;
CREATE TRIGGER slr_no_delete BEFORE DELETE ON business.strategic_learning_record
  FOR EACH ROW EXECUTE FUNCTION business.slr_forbid_delete();

COMMENT ON COLUMN business.strategic_learning_record.lifecycle_action IS 'CREATE|REFINE|CONTEST|SUPERSEDE|RETIRE — the founder-directed transition that produced this revision (ADR-012, single-thread lifecycle).';
COMMENT ON COLUMN business.strategic_learning_record.root_learning_id IS 'The CREATE revision id of this logical thread (stable; copied, never inferred).';
COMMENT ON COLUMN business.strategic_learning_record.predecessor_learning_id IS 'Exact immediate predecessor revision id; NULL for CREATE. Unique per founder — enforces no-fork.';
