-- V073: Strategic Commitment Record (ADR-011 category 11) — a founder-EXPLICIT, APPEND-ONLY declaration that a specific
-- Strategic Decision will govern the founder's strategic conduct for a BOUNDED scope and period, with visible review,
-- exit, and reconsideration conditions. Mirrors the V072 Strategic-Decision discipline: immutable versioned rows keyed by
-- (founder, logical_commitment_id, revision); a `lifecycle` marker records what each version IS (CREATE | SUPERSEDE |
-- RELEASE | RETIRE); effective status is DERIVED from MAX(revision)+lifecycle (with EXPIRED derived at read time from
-- expires_at); a BEFORE UPDATE trigger forbids ANY update. Every commitment references an EXACT immutable decision
-- revision. No FK cascade; account deletion is the only destructive path. Not a plan/task/execution record; not memory.*.

CREATE TABLE IF NOT EXISTS business.strategic_commitment_record (
  id                              TEXT        PRIMARY KEY,
  founder_id                      TEXT        NOT NULL,
  logical_commitment_id           TEXT        NOT NULL,
  revision                        INTEGER     NOT NULL,
  lifecycle                       TEXT        NOT NULL,                -- CREATE | SUPERSEDE | RELEASE | RETIRE
  supersedes_id                   TEXT,
  -- decision linkage (the EXACT immutable decision revision — Law 7)
  decision_record_id              TEXT        NOT NULL,
  decision_logical_id             TEXT        NOT NULL,
  decision_revision               INTEGER     NOT NULL,
  decision_schema_version         TEXT        NOT NULL,
  recommendation_session_id       TEXT,
  recommendation_schema_version   TEXT,
  provenance_manifest_version     TEXT,
  alignment_at_commitment         TEXT        NOT NULL,
  grounding_status_at_commitment  TEXT,                               -- inherited from the decision; never upgraded
  -- founder-authored
  statement                       TEXT        NOT NULL,
  scope                           TEXT        NOT NULL,
  exclusivity                     TEXT        NOT NULL,
  governed_behavior               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  resource_envelope               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  accepted_costs                  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  unknown_costs                   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  exit_conditions                 JSONB       NOT NULL DEFAULT '[]'::jsonb,
  reconsideration_conditions      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_insufficient_evidence BOOLEAN  NOT NULL DEFAULT FALSE,
  -- boundary (Law 3)
  starts_at                       TIMESTAMPTZ NOT NULL,
  review_at                       TIMESTAMPTZ,
  review_trigger                  TEXT,
  expires_at                      TIMESTAMPTZ,
  authorship                      JSONB       NOT NULL,
  idempotency_key                 TEXT        NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_scr_founder_logical_revision
  ON business.strategic_commitment_record (founder_id, logical_commitment_id, revision);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_scr_founder_idempotency
  ON business.strategic_commitment_record (founder_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_scr_founder ON business.strategic_commitment_record (founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scr_decision ON business.strategic_commitment_record (founder_id, decision_logical_id);

CREATE OR REPLACE FUNCTION business.scr_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'strategic_commitment_record is append-only: UPDATE is forbidden (append a new revision instead)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scr_no_update ON business.strategic_commitment_record;
CREATE TRIGGER scr_no_update BEFORE UPDATE ON business.strategic_commitment_record
  FOR EACH ROW EXECUTE FUNCTION business.scr_forbid_update();

COMMENT ON TABLE business.strategic_commitment_record IS 'ADR-011 cat 11 — founder-explicit, append-only Strategic Commitment Records (schema strategic-commitment-1). Immutable revisions per (founder, logical_commitment_id, revision); effective status derived from MAX(revision)+lifecycle (EXPIRED derived at read from expires_at); BEFORE-UPDATE trigger forbids mutation. References an exact decision revision. Not a plan/task/execution record; not memory.*.';
