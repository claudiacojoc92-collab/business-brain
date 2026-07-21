-- V076: Strategic Learning Record (ADR-011 cat 14 precursor — durable learning, NOT generic Strategic Memory) — a
-- founder-EXPLICIT, APPEND-ONLY durable strategic understanding the founder decides to keep after a review, with the
-- full Review->Plan->Commitment->Decision->Recommendation->Evidence lineage. Mirrors the immutable-record discipline of
-- V072-V075: a BEFORE UPDATE trigger forbids ANY update (a learning is never mutated; a correction is another
-- append-only learning). Idempotent create via a unique (founder, idempotency_key). Creating a learning writes ONLY this
-- record and mutates NOTHING — never Review/Plan/Commitment/Decision/Recommendation, and NEVER auto-modifies Business
-- Understanding or Founder Strategic Context (Laws 12-14; promotion into BU/FSC is a future gate). Preserves uncertainty
-- (confidence is ESTABLISHED|TENTATIVE|CONDITIONAL, never absolute). No FK cascade; account deletion is the only
-- destructive path. Not memory.*, not the dead founder.belief_chains legacy table.

CREATE TABLE IF NOT EXISTS business.strategic_learning_record (
  id                              TEXT        PRIMARY KEY,
  founder_id                      TEXT        NOT NULL,
  logical_learning_id             TEXT        NOT NULL,
  revision                        INTEGER     NOT NULL DEFAULT 1,
  schema_version                  TEXT        NOT NULL,
  -- lineage (the EXACT review promoted from + its immutable lineage)
  review_record_id                TEXT        NOT NULL,
  review_revision                 INTEGER     NOT NULL,
  plan_record_id                  TEXT        NOT NULL,
  commitment_record_id            TEXT        NOT NULL,
  decision_record_id              TEXT,
  recommendation_session_id       TEXT,
  provenance_manifest_version     TEXT,
  -- founder-authored
  learning_statement              TEXT        NOT NULL,
  learning_category               TEXT        NOT NULL,
  confidence                      TEXT        NOT NULL,
  -- authorship
  founder_authored                BOOLEAN     NOT NULL DEFAULT TRUE,
  model_suggested                 BOOLEAN     NOT NULL DEFAULT FALSE,
  accepted_by_founder             BOOLEAN     NOT NULL DEFAULT TRUE,
  idempotency_key                 TEXT        NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_slr_founder_idempotency
  ON business.strategic_learning_record (founder_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_slr_founder ON business.strategic_learning_record (founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slr_review ON business.strategic_learning_record (founder_id, review_record_id);

CREATE OR REPLACE FUNCTION business.slr_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'strategic_learning_record is append-only: UPDATE is forbidden (append another learning instead)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS slr_no_update ON business.strategic_learning_record;
CREATE TRIGGER slr_no_update BEFORE UPDATE ON business.strategic_learning_record
  FOR EACH ROW EXECUTE FUNCTION business.slr_forbid_update();

COMMENT ON TABLE business.strategic_learning_record IS 'ADR-011 cat 14 precursor — founder-explicit, append-only Strategic Learning Records (schema strategic-learning-1): a durable strategic understanding kept after a review. Immutable; BEFORE-UPDATE trigger forbids mutation. References the EXACT review + full lineage; confidence ESTABLISHED|TENTATIVE|CONDITIONAL (never absolute). Creating one mutates NOTHING and NEVER auto-modifies Business Understanding or Founder Strategic Context. Not generic Strategic Memory; not memory.*; not founder.belief_chains.';
