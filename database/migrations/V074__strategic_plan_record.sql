-- V074: Strategic Plan Record (ADR-011 category 12) — a founder-EXPLICIT, APPEND-ONLY translation of ONE effective
-- Strategic Commitment into intended strategic moves, milestones, review conditions, assumptions, and dependencies.
-- Mirrors the V073 Strategic-Commitment discipline: immutable versioned rows keyed by (founder, logical_plan_id,
-- revision); a `lifecycle` marker records what each version IS (CREATE | SUPERSEDE | RETIRE | CANCEL); effective status
-- is DERIVED from MAX(revision)+lifecycle (EXPIRED derived at read from expires_at); a BEFORE UPDATE trigger forbids ANY
-- update. Every plan references an EXACT immutable commitment revision. Milestones/assumptions/dependencies/conflicts are
-- JSONB (no task/milestone/execution table). No FK cascade; account deletion is the only destructive path. NOT execution,
-- tasks, a calendar, an agent, or memory.*; there are NO IN_PROGRESS/COMPLETED states (execution is future).

CREATE TABLE IF NOT EXISTS business.strategic_plan_record (
  id                              TEXT        PRIMARY KEY,
  founder_id                      TEXT        NOT NULL,
  logical_plan_id                 TEXT        NOT NULL,
  revision                        INTEGER     NOT NULL,
  lifecycle                       TEXT        NOT NULL,                -- CREATE | SUPERSEDE | RETIRE | CANCEL
  supersedes_id                   TEXT,
  -- commitment linkage (the EXACT immutable commitment revision — Law 4/9)
  commitment_record_id            TEXT        NOT NULL,
  commitment_logical_id           TEXT        NOT NULL,
  commitment_revision             INTEGER     NOT NULL,
  commitment_schema_version       TEXT        NOT NULL,
  decision_record_id              TEXT,
  recommendation_session_id       TEXT,
  provenance_manifest_version     TEXT,
  business_understanding_version  INTEGER,
  alignment_at_planning           TEXT        NOT NULL,
  grounding_status_at_planning    TEXT,                               -- inherited from the commitment; never upgraded
  -- founder-authored
  title                           TEXT        NOT NULL,
  strategic_intent                TEXT        NOT NULL,
  scope                           TEXT        NOT NULL,
  planning_horizon                TEXT,
  milestones                      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  assumptions                     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  dependencies                    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  resource_constraints            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  review_conditions               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  exit_conditions                 JSONB       NOT NULL DEFAULT '[]'::jsonb,
  no_milestone_rationale          TEXT,
  acknowledged_insufficient_evidence BOOLEAN  NOT NULL DEFAULT FALSE,
  -- system-derived
  uncertainty_at_planning         JSONB,
  conflicts                       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  authorship                      JSONB       NOT NULL,
  expires_at                      TIMESTAMPTZ,
  activated_at                    TIMESTAMPTZ NOT NULL,
  idempotency_key                 TEXT        NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_spr_founder_logical_revision
  ON business.strategic_plan_record (founder_id, logical_plan_id, revision);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_spr_founder_idempotency
  ON business.strategic_plan_record (founder_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_spr_founder ON business.strategic_plan_record (founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spr_commitment ON business.strategic_plan_record (founder_id, commitment_logical_id);

CREATE OR REPLACE FUNCTION business.spr_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'strategic_plan_record is append-only: UPDATE is forbidden (append a new revision instead)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS spr_no_update ON business.strategic_plan_record;
CREATE TRIGGER spr_no_update BEFORE UPDATE ON business.strategic_plan_record
  FOR EACH ROW EXECUTE FUNCTION business.spr_forbid_update();

COMMENT ON TABLE business.strategic_plan_record IS 'ADR-011 cat 12 — founder-explicit, append-only Strategic Plan Records (schema strategic-plan-1). Immutable revisions per (founder, logical_plan_id, revision); effective status derived from MAX(revision)+lifecycle (EXPIRED derived at read from expires_at); BEFORE-UPDATE trigger forbids mutation. References an exact commitment revision. Milestones/assumptions/dependencies/conflicts are JSONB. Not execution/tasks/calendar/agent; not memory.*; no IN_PROGRESS/COMPLETED states.';
