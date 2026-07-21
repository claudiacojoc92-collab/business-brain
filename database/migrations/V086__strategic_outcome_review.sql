-- V086: Strategic Outcome Review Boundary (ADR-016) — the constitutional boundary between an Execution Report and Strategic
-- Learning. An append-only, immutable, founder-initiated record that compares, for one EXACT Plan revision: what was
-- intended, what the founder reported executing, what evidence existed, and what outcome was observed — plus what remains
-- unknown. It produces ONLY an immutable historical assessment: it answers NO "what next"; it creates NO Learning/Promotion;
-- it changes NO Understanding/Recommendation/Effective-Context/Plan/Execution/Decision/Commitment; it verifies nothing; it
-- scores nothing. UNKNOWN is first-class. No hindsight — a later Review is a NEW row and never edits an earlier one. The
-- assessment is a DETERMINISTIC composition of the frozen inputs; a SHA-256 content hash makes each Review reproducible
-- forever. Append-only guarantees mirror V083/V075: BEFORE-UPDATE forbidden; individual DELETE gated on
-- bb.allow_strategic_review_delete (founder-account-deletion path only). Distinct from strategic_plan_review_record (V075).
-- Forward-only; edits no earlier migration.

CREATE TABLE IF NOT EXISTS business.strategic_outcome_review (
  id                        TEXT        PRIMARY KEY,
  founder_id                TEXT        NOT NULL,
  -- the EXACT reviewed Plan revision + lineage (immutable references — Law 4)
  plan_record_id            TEXT        NOT NULL,   -- exact plan revision id
  plan_logical_id           TEXT        NOT NULL,
  plan_revision             INTEGER     NOT NULL,
  plan_schema_version       TEXT        NOT NULL,
  commitment_record_id      TEXT        NOT NULL,
  commitment_logical_id     TEXT        NOT NULL,
  -- the EXACT frozen Context Snapshot consumed (id + content hash)
  context_snapshot_id       TEXT        NOT NULL,
  context_snapshot_hash     TEXT        NOT NULL,
  -- ordering within (founder, plan revision); a later Review is a NEW row (never edits an earlier)
  review_sequence           INTEGER     NOT NULL,
  -- the immutable, deterministically-composed assessment payload (intended / reported / evidence / outcome / unknowns)
  assessment                JSONB       NOT NULL,
  observed_outcome          TEXT        NOT NULL,   -- AS_INTENDED | PARTIALLY_AS_INTENDED | NOT_AS_INTENDED | UNKNOWN
  founder_outcome_statement TEXT        NOT NULL,
  unknowns                  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- frozen method provenance for reproducibility (Law 5/6) — deterministic, no model
  assessment_method         TEXT        NOT NULL DEFAULT 'DETERMINISTIC_COMPOSITION',
  prompt_template_hash      TEXT        NOT NULL,
  model_configuration       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  review_schema_version     TEXT        NOT NULL,
  content_hash              TEXT        NOT NULL,   -- SHA-256 over canonical serialization of `assessment`
  idempotency_key           TEXT        NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sor_observed_outcome_enum') THEN
    ALTER TABLE business.strategic_outcome_review ADD CONSTRAINT sor_observed_outcome_enum
      CHECK (observed_outcome IN ('AS_INTENDED','PARTIALLY_AS_INTENDED','NOT_AS_INTENDED','UNKNOWN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sor_sequence_positive') THEN
    ALTER TABLE business.strategic_outcome_review ADD CONSTRAINT sor_sequence_positive CHECK (review_sequence > 0);
  END IF;
  -- The Review is deterministic (Law 6): no model participates, so model_configuration is always empty.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sor_deterministic_no_model') THEN
    ALTER TABLE business.strategic_outcome_review ADD CONSTRAINT sor_deterministic_no_model
      CHECK (assessment_method = 'DETERMINISTIC_COMPOSITION' AND model_configuration = '{}'::jsonb);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sor_founder_idempotency
  ON business.strategic_outcome_review (founder_id, idempotency_key);
-- One sequence number per (founder, exact plan revision) chain of reviews — deterministic ordering, no collisions.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sor_revision_sequence
  ON business.strategic_outcome_review (founder_id, plan_record_id, review_sequence);
CREATE INDEX IF NOT EXISTS idx_sor_plan ON business.strategic_outcome_review (founder_id, plan_record_id, review_sequence);
CREATE INDEX IF NOT EXISTS idx_sor_founder ON business.strategic_outcome_review (founder_id, created_at DESC);

-- Append-only: UPDATE forbidden (a Review is never edited; a later look is another append-only Review — Law 2/3).
CREATE OR REPLACE FUNCTION business.sor_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'strategic_outcome_review is append-only: UPDATE is forbidden (a later review is a new immutable review)';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sor_no_update ON business.strategic_outcome_review;
CREATE TRIGGER sor_no_update BEFORE UPDATE ON business.strategic_outcome_review
  FOR EACH ROW EXECUTE FUNCTION business.sor_forbid_update();

-- Individual DELETE forbidden unless the founder-account-deletion transaction opts in (only destructive path — Law 12).
CREATE OR REPLACE FUNCTION business.sor_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_strategic_review_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'strategic_outcome_review is append-only: individual DELETE is forbidden (only founder-account deletion may remove reviews)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sor_no_delete ON business.strategic_outcome_review;
CREATE TRIGGER sor_no_delete BEFORE DELETE ON business.strategic_outcome_review
  FOR EACH ROW EXECUTE FUNCTION business.sor_forbid_delete();

COMMENT ON TABLE business.strategic_outcome_review IS 'ADR-016 Strategic Outcome Review Boundary — append-only immutable retrospective comparing intended action, founder-reported execution, available evidence, and observed outcome for one EXACT Plan revision. Produces ONLY a historical assessment; answers no "what next"; creates no Learning/Promotion; changes no other record; verifies/scores nothing. UNKNOWN first-class. Deterministic composition (no model); SHA-256 content_hash → reproducible forever. Distinct from strategic_plan_review_record (V075).';
