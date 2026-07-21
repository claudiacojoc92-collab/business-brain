-- V083: Strategic Execution Boundary (ADR-015). An append-only, immutable ledger of FOUNDER TESTIMONY about execution —
-- what the founder REPORTS doing against a plan milestone (or the plan). It is NOT execution, tasks, automation, or a
-- product-performed action. The product performs NOTHING and verifies NOTHING here: every report is
-- UNVERIFIED_FOUNDER_REPORT / NOT_PERFORMED_BY_PRODUCT. Effective state derives from an explicit sequence/predecessor chain
-- (never created_at). Corrections/withdrawals are new events; history is never mutated. No plan/decision/commitment/review
-- state changes; no downstream artifacts. Forward-only; does NOT edit earlier migrations.

CREATE TABLE IF NOT EXISTS business.execution_report (
  id                     TEXT        PRIMARY KEY,
  founder_id             TEXT        NOT NULL,
  subject_type           TEXT        NOT NULL,   -- MILESTONE | PLAN
  subject_id             TEXT        NOT NULL,   -- milestone id (MILESTONE) | plan logical id (PLAN)
  plan_logical_id        TEXT        NOT NULL,   -- stable plan identity (the chain groups by this + subject)
  plan_id                TEXT        NOT NULL,   -- the EXACT immutable plan revision current when reported (provenance)
  plan_revision          INTEGER     NOT NULL,
  report_sequence        INTEGER     NOT NULL,   -- 1..N per (founder, plan_logical_id, subject) — deterministic order
  predecessor_report_id  TEXT,                   -- the exact prior head this event supersedes (null only at sequence 1)
  report_kind            TEXT        NOT NULL,   -- REPORT | CORRECT | WITHDRAW
  execution_state        TEXT        NOT NULL,   -- NOT_STARTED|ATTEMPTED|COMPLETED|BLOCKED|ABANDONED|NOT_APPLICABLE|WITHDRAWN
  founder_statement      TEXT        NOT NULL,   -- founder's exact words (bounded) — testimony
  occurred_at            TIMESTAMPTZ,            -- founder-CLAIMED occurrence (nullable) — not verified
  reported_at            TIMESTAMPTZ NOT NULL DEFAULT now(), -- server-controlled
  evidence_references    JSONB       NOT NULL DEFAULT '[]'::jsonb, -- bounded {type,value,label}; NEVER fetched/verified
  idempotency_key        TEXT        NOT NULL,
  source                 TEXT        NOT NULL DEFAULT 'FOUNDER',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exr_subject_type_enum') THEN
    ALTER TABLE business.execution_report ADD CONSTRAINT exr_subject_type_enum CHECK (subject_type IN ('MILESTONE','PLAN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exr_kind_enum') THEN
    ALTER TABLE business.execution_report ADD CONSTRAINT exr_kind_enum CHECK (report_kind IN ('REPORT','CORRECT','WITHDRAW'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exr_state_enum') THEN
    ALTER TABLE business.execution_report ADD CONSTRAINT exr_state_enum
      CHECK (execution_state IN ('NOT_STARTED','ATTEMPTED','COMPLETED','BLOCKED','ABANDONED','NOT_APPLICABLE','WITHDRAWN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exr_sequence_positive') THEN
    ALTER TABLE business.execution_report ADD CONSTRAINT exr_sequence_positive CHECK (report_sequence > 0);
  END IF;
  -- The first event of a chain is a REPORT at sequence 1 with null predecessor; later events have a predecessor.
  -- A WITHDRAW carries execution_state='WITHDRAWN' (the state field is non-null); effective state = NOT_REPORTED (derived).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exr_sequence_predecessor_shape') THEN
    ALTER TABLE business.execution_report ADD CONSTRAINT exr_sequence_predecessor_shape CHECK (
      (report_sequence = 1 AND predecessor_report_id IS NULL AND report_kind = 'REPORT')
      OR (report_sequence > 1 AND predecessor_report_id IS NOT NULL)
    );
  END IF;
END $$;

-- Contiguity + no duplicate sequence within a (founder, plan, subject) chain.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_exr_chain_sequence
  ON business.execution_report (founder_id, plan_logical_id, subject_type, subject_id, report_sequence);
-- No fork: each predecessor event may be consumed by exactly one successor.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_exr_predecessor
  ON business.execution_report (founder_id, predecessor_report_id) WHERE predecessor_report_id IS NOT NULL;
-- Idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_exr_founder_idempotency
  ON business.execution_report (founder_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_exr_effective
  ON business.execution_report (founder_id, plan_logical_id, subject_type, subject_id, report_sequence DESC);

-- Append-only: UPDATE forbidden (a correction is another append-only event — testimony is never silently mutated).
CREATE OR REPLACE FUNCTION business.exr_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'execution_report is append-only: UPDATE is forbidden (append a CORRECT/WITHDRAW event instead)';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS exr_no_update ON business.execution_report;
CREATE TRIGGER exr_no_update BEFORE UPDATE ON business.execution_report
  FOR EACH ROW EXECUTE FUNCTION business.exr_forbid_update();

-- Individual DELETE forbidden unless the founder-account-deletion transaction opts in (only destructive path).
CREATE OR REPLACE FUNCTION business.exr_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_execution_report_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'execution_report is append-only: individual DELETE is forbidden (only founder-account deletion may remove execution testimony)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS exr_no_delete ON business.execution_report;
CREATE TRIGGER exr_no_delete BEFORE DELETE ON business.execution_report
  FOR EACH ROW EXECUTE FUNCTION business.exr_forbid_delete();

COMMENT ON TABLE business.execution_report IS 'ADR-015 Strategic Execution Boundary — append-only ledger of FOUNDER TESTIMONY about execution against a plan milestone/plan. NOT execution, tasks, or a product-performed action: the product performs and verifies nothing (UNVERIFIED_FOUNDER_REPORT / NOT_PERFORMED_BY_PRODUCT). Effective state derived from the sequence/predecessor chain, never created_at. Corrections/withdrawals are new events; history is immutable. No plan/decision/commitment/review mutation; no downstream artifacts.';
