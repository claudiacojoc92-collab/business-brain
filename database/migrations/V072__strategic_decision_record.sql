-- V072: Strategic Decision Record (ADR-011 category 10) — a founder-EXPLICIT, APPEND-ONLY record of a strategic choice
-- among understood alternatives, with the decision-time evidence/recommendation/context/uncertainty/trade-offs preserved.
-- Mirrors the V067/V068 Founder-Strategic-Context discipline: immutable versioned rows keyed by (founder, logical
-- decision, revision); a `lifecycle` marker records what each version IS (CREATE | SUPERSEDE | REVERSE | RETIRE); the
-- effective status is DERIVED from MAX(revision)+lifecycle; a BEFORE UPDATE trigger forbids ANY update (append-only).
-- No FK cascade; account deletion is the only destructive path (explicit in delete.service.ts). This is NOT the legacy
-- memory.* decision primitive and NOT a Strategic Commitment.

CREATE TABLE IF NOT EXISTS business.strategic_decision_record (
  id                              TEXT        PRIMARY KEY,
  founder_id                      TEXT        NOT NULL,
  logical_decision_id             TEXT        NOT NULL,                -- stable identity across revisions
  revision                        INTEGER     NOT NULL,                -- 1..N, immutable per row
  lifecycle                       TEXT        NOT NULL,                -- CREATE | SUPERSEDE | REVERSE | RETIRE
  supersedes_id                   TEXT,                               -- the prior revision this row follows (null for CREATE)
  -- founder-authored
  chosen_option                   JSONB       NOT NULL,                -- { label, source, statement }
  decision_statement              TEXT        NOT NULL,
  rationale                       TEXT,
  alternatives_considered         JSONB       NOT NULL,                -- [{ label, source, disposition, reason }]
  trade_offs_accepted             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_insufficient_evidence BOOLEAN  NOT NULL DEFAULT FALSE,
  review_trigger                  TEXT,
  -- system-derived / references (decision-time; never rewritten by later context)
  recommendation_session_id       TEXT,                               -- the immutable strategy session (Law 4)
  recommendation_schema_version   TEXT,
  provenance_manifest_version     TEXT,                               -- links to the persisted manifest (Law 5)
  business_understanding_version  INTEGER,
  decision_horizon                TEXT,
  alignment                       TEXT        NOT NULL,                -- ALIGNED | PARTIALLY_ALIGNED | DIVERGENT | NO_RECOMMENDATION
  grounding_status_at_decision    TEXT,                               -- from the session; never upgraded
  scope                           TEXT        NOT NULL,
  reversibility                   TEXT        NOT NULL,
  uncertainty                     JSONB,                              -- { confidence, unknowns[], groundingStatus }
  authorship                      JSONB       NOT NULL,                -- field -> FOUNDER_AUTHORED | RECOMMENDATION_DERIVED | SYSTEM_DERIVED
  idempotency_key                 TEXT        NOT NULL,
  decided_at                      TIMESTAMPTZ NOT NULL,
  review_at                       TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Concurrency arbiter + append-only identity: exactly one row per (founder, logical decision, revision).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sdr_founder_logical_revision
  ON business.strategic_decision_record (founder_id, logical_decision_id, revision);
-- Idempotent creation: a retried create with the same key must not create a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sdr_founder_idempotency
  ON business.strategic_decision_record (founder_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_sdr_founder ON business.strategic_decision_record (founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sdr_session ON business.strategic_decision_record (founder_id, recommendation_session_id);

-- APPEND-ONLY enforcement: no row may ever be UPDATEd (change = a new appended revision).
CREATE OR REPLACE FUNCTION business.sdr_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'strategic_decision_record is append-only: UPDATE is forbidden (append a new revision instead)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sdr_no_update ON business.strategic_decision_record;
CREATE TRIGGER sdr_no_update BEFORE UPDATE ON business.strategic_decision_record
  FOR EACH ROW EXECUTE FUNCTION business.sdr_forbid_update();

COMMENT ON TABLE business.strategic_decision_record IS 'ADR-011 cat 10 — founder-explicit, append-only Strategic Decision Records (schema strategic-decision-1). Immutable revisions per (founder, logical_decision_id, revision); effective status derived from MAX(revision)+lifecycle; BEFORE-UPDATE trigger forbids mutation. Not the legacy memory.* decision; not a Strategic Commitment.';
