-- V081: Strategic Learning Consumption Gate (ADR-014). The ONLY way the Recommendation Engine may consume the canonical
-- Effective Business Understanding + Effective Founder Strategic Context: a founder-created, APPEND-ONLY, immutable
-- ContextSnapshot that freezes the currently-effective BU/FSC (native + promoted learning revisions) with provenance +
-- timestamp + content hash. A recommendation reasons over the FROZEN snapshot, never live context; it records the exact
-- snapshot id it consumed. Consumption is explicit; promotion never implies consumption; nothing is consumed automatically.

CREATE TABLE IF NOT EXISTS business.context_snapshot (
  id                          TEXT        PRIMARY KEY,
  founder_id                  TEXT        NOT NULL,
  business_understanding      JSONB       NOT NULL,   -- frozen assembler-shaped Effective BU (native + promoted conclusions)
  founder_strategic_context   JSONB       NOT NULL,   -- frozen assembler-shaped Effective FSC (native items + promotedLearnings)
  provenance                  JSONB       NOT NULL,   -- per-item provenance (native vs PROMOTED_LEARNING; exact revision)
  content_hash                TEXT        NOT NULL,   -- deterministic hash over the frozen payload
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_snapshot_founder
  ON business.context_snapshot (founder_id, created_at DESC);

-- Append-only: UPDATE forbidden (a snapshot is immutable — a new freeze is a new row).
CREATE OR REPLACE FUNCTION business.context_snapshot_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'context_snapshot is append-only: UPDATE is forbidden (create a new snapshot instead)';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS context_snapshot_no_update ON business.context_snapshot;
CREATE TRIGGER context_snapshot_no_update BEFORE UPDATE ON business.context_snapshot
  FOR EACH ROW EXECUTE FUNCTION business.context_snapshot_forbid_update();

-- Individual DELETE forbidden unless the founder-account-deletion transaction opts in (only destructive path).
CREATE OR REPLACE FUNCTION business.context_snapshot_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_snapshot_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'context_snapshot is append-only: individual DELETE is forbidden (only founder-account deletion may remove snapshots)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS context_snapshot_no_delete ON business.context_snapshot;
CREATE TRIGGER context_snapshot_no_delete BEFORE DELETE ON business.context_snapshot
  FOR EACH ROW EXECUTE FUNCTION business.context_snapshot_forbid_delete();

-- Which immutable snapshot a recommendation session consumed (NULL = the pre-existing live legacy path, unchanged).
ALTER TABLE business.strategic_session
  ADD COLUMN IF NOT EXISTS context_snapshot_id TEXT;

COMMENT ON TABLE business.context_snapshot IS 'ADR-014 Strategic Learning Consumption Gate — append-only immutable freeze of the canonical Effective BU + Effective FSC (native + promoted learning revisions) that a recommendation may consume. Reasoning reads the frozen snapshot, never live context; promotion never implies consumption; nothing is consumed automatically. No model authority.';
COMMENT ON COLUMN business.strategic_session.context_snapshot_id IS 'ADR-014: the exact context_snapshot this recommendation consumed (immutable reference). NULL for the legacy live path.';
