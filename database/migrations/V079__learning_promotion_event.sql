-- V079: Strategic Learning Promotion Gate (ADR-013). The ONLY explicit path by which a founder promotes an EXACT learning
-- revision into Business Understanding (BU) or Founder Strategic Context (FSC). A SEPARATE append-only ledger — it writes
-- to NEITHER business.understanding NOR business.founder_strategic_context_item and edits no chain record. The effective
-- promoted set is DERIVED from events (latest event per thread per target wins), never from the latest learning revision.
-- Promotion is governance, not evidence; explicit founder judgment only; no model authority; regenerates nothing.

CREATE TABLE IF NOT EXISTS business.learning_promotion_event (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  target                TEXT        NOT NULL,   -- BUSINESS_UNDERSTANDING | FOUNDER_STRATEGIC_CONTEXT
  logical_learning_id   TEXT        NOT NULL,   -- the learning thread
  learning_revision_id  TEXT        NOT NULL,   -- the EXACT immutable revision promoted (Laws 5, 18)
  revision_number       INTEGER     NOT NULL,
  promotion_action      TEXT        NOT NULL,   -- PROMOTE | REPLACE | REMOVE
  rationale             TEXT        NOT NULL,   -- founder rationale (Law 8)
  scope                 TEXT        NOT NULL,   -- intended scope (Law 9)
  idempotency_key       TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lpe_target_enum') THEN
    ALTER TABLE business.learning_promotion_event ADD CONSTRAINT lpe_target_enum
      CHECK (target IN ('BUSINESS_UNDERSTANDING','FOUNDER_STRATEGIC_CONTEXT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lpe_action_enum') THEN
    ALTER TABLE business.learning_promotion_event ADD CONSTRAINT lpe_action_enum
      CHECK (promotion_action IN ('PROMOTE','REPLACE','REMOVE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lpe_revision_positive') THEN
    ALTER TABLE business.learning_promotion_event ADD CONSTRAINT lpe_revision_positive CHECK (revision_number > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_lpe_founder_idempotency
  ON business.learning_promotion_event (founder_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_lpe_effective
  ON business.learning_promotion_event (founder_id, target, logical_learning_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lpe_revision
  ON business.learning_promotion_event (founder_id, learning_revision_id);

-- Append-only: UPDATE forbidden (a correction is another append-only event — Laws 3, 17).
CREATE OR REPLACE FUNCTION business.lpe_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'learning_promotion_event is append-only: UPDATE is forbidden (append another promotion event instead)';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS lpe_no_update ON business.learning_promotion_event;
CREATE TRIGGER lpe_no_update BEFORE UPDATE ON business.learning_promotion_event
  FOR EACH ROW EXECUTE FUNCTION business.lpe_forbid_update();

-- Individual DELETE forbidden unless the founder-account-deletion transaction opts in (Law 20; only destructive path).
CREATE OR REPLACE FUNCTION business.lpe_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_promotion_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'learning_promotion_event is append-only: individual DELETE is forbidden (only founder-account deletion may remove promotion history)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS lpe_no_delete ON business.learning_promotion_event;
CREATE TRIGGER lpe_no_delete BEFORE DELETE ON business.learning_promotion_event
  FOR EACH ROW EXECUTE FUNCTION business.lpe_forbid_delete();

COMMENT ON TABLE business.learning_promotion_event IS 'ADR-013 Strategic Learning Promotion Gate — append-only ledger of founder-explicit promotions of an EXACT learning revision into BU/FSC. Writes to NEITHER business.understanding NOR founder_strategic_context_item; edits no chain record; regenerates nothing. Effective promoted set derived from events (latest event per thread per target wins), never from the latest learning revision. No model authority.';
