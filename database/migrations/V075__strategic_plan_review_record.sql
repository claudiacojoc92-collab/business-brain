-- V075: Strategic Plan Review Record (ADR-011 cat 12, review sub-capability) — a founder-EXPLICIT, APPEND-ONLY assessment
-- of an EXACT Strategic Plan revision: observations, assumption/dependency/milestone assessments, context changes, a
-- descriptive conclusion, and an intended disposition. Mirrors the immutable-record discipline of V072–V074: a
-- BEFORE UPDATE trigger forbids ANY update (a review is never mutated; a correction is another append-only review).
-- Idempotent create via a unique (founder, idempotency_key). Every review references an EXACT immutable plan revision
-- + its lineage. Milestones/assumptions/dependencies assessments + observations + context changes are JSONB. No FK
-- cascade; account deletion is the only destructive path. Creating a review performs NO plan/commitment/decision
-- lifecycle mutation and creates NO execution/task/progress/score object; NOT memory.*.

CREATE TABLE IF NOT EXISTS business.strategic_plan_review_record (
  id                              TEXT        PRIMARY KEY,
  founder_id                      TEXT        NOT NULL,
  logical_review_id               TEXT        NOT NULL,
  revision                        INTEGER     NOT NULL DEFAULT 1,
  schema_version                  TEXT        NOT NULL,
  -- plan/lineage linkage (the EXACT reviewed plan revision + its immutable lineage)
  plan_record_id                  TEXT        NOT NULL,
  plan_logical_id                 TEXT        NOT NULL,
  plan_revision                   INTEGER     NOT NULL,
  plan_schema_version             TEXT        NOT NULL,
  commitment_record_id            TEXT        NOT NULL,
  commitment_logical_id           TEXT        NOT NULL,
  commitment_revision             INTEGER     NOT NULL,
  decision_record_id              TEXT,
  recommendation_session_id       TEXT,
  provenance_manifest_version     TEXT,
  grounding_status_at_planning    TEXT,
  alignment_at_planning           TEXT        NOT NULL,
  -- founder-authored
  review_statement                TEXT,
  review_period_start             TIMESTAMPTZ,
  review_period_end               TIMESTAMPTZ,
  observations                    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  evidence_references             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  assumption_assessments          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  dependency_assessments          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  milestone_assessments           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  context_changes                 JSONB       NOT NULL DEFAULT '[]'::jsonb,
  unresolved_unknowns             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  review_conclusion               TEXT        NOT NULL,
  selected_disposition            TEXT        NOT NULL,
  authorship                      JSONB       NOT NULL,
  idempotency_key                 TEXT        NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sprr_founder_idempotency
  ON business.strategic_plan_review_record (founder_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_sprr_founder ON business.strategic_plan_review_record (founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sprr_plan ON business.strategic_plan_review_record (founder_id, plan_logical_id, created_at DESC);

CREATE OR REPLACE FUNCTION business.sprr_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'strategic_plan_review_record is append-only: UPDATE is forbidden (append another review instead)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sprr_no_update ON business.strategic_plan_review_record;
CREATE TRIGGER sprr_no_update BEFORE UPDATE ON business.strategic_plan_review_record
  FOR EACH ROW EXECUTE FUNCTION business.sprr_forbid_update();

COMMENT ON TABLE business.strategic_plan_review_record IS 'ADR-011 cat 12 (review sub-capability) — founder-explicit, append-only Strategic Plan Review Records (schema strategic-plan-review-1). Immutable; BEFORE-UPDATE trigger forbids mutation. References an EXACT plan revision + lineage; assessments map to the exact original plan elements. Creating a review performs NO plan/commitment/decision lifecycle mutation; no execution/task/progress/score object; not memory.*.';
