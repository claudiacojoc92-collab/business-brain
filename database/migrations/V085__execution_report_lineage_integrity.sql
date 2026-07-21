-- V085: Strategic Execution Boundary — DATABASE-enforced lineage integrity (ADR-015, Laws 1–9). The revision-scoping
-- remediation (V084) fixed the APPLICATION's chain identity, but a direct-SQL audit proved the DATABASE still accepted a
-- predecessor belonging to another Plan revision, another subject, another founder, or a non-adjacent sequence:
-- predecessor_report_id had NO foreign key and no validating trigger, so chain-identity matching was application-only
-- (classification B). This migration makes canonical chain identity a database guarantee: every non-initial event's
-- predecessor must be the immediately-preceding event (sequence-1) of the IDENTICAL
-- (founder_id, plan_id, subject_type, subject_id) chain. Declarative, enforced by the relational engine (Preferred option:
-- composite self-FK + generated adjacency column). Forward-only; does NOT edit V083/V084. Append-only triggers, no-fork,
-- revision-scoped sequence uniqueness, idempotency, and account-deletion behaviour are all preserved.

-- ── Data audit BEFORE enabling stricter enforcement — refuse to add the FK over corrupt lineage (never silently rewrite).
DO $$
DECLARE
  cross_chain    bigint;
  non_adjacent   bigint;
  missing_pred   bigint;
  bad_initial    bigint;
  missing_on_seq bigint;
  total_rows     bigint;
BEGIN
  SELECT count(*) INTO total_rows FROM business.execution_report;

  -- cross-founder / cross-revision / cross-subject predecessors
  SELECT count(*) INTO cross_chain
    FROM business.execution_report c
    JOIN business.execution_report p ON p.id = c.predecessor_report_id
   WHERE c.predecessor_report_id IS NOT NULL
     AND (c.founder_id <> p.founder_id OR c.plan_id <> p.plan_id
          OR c.subject_type <> p.subject_type OR c.subject_id <> p.subject_id);

  -- non-adjacent sequence (predecessor is not exactly one step behind)
  SELECT count(*) INTO non_adjacent
    FROM business.execution_report c
    JOIN business.execution_report p ON p.id = c.predecessor_report_id
   WHERE c.predecessor_report_id IS NOT NULL
     AND c.report_sequence <> p.report_sequence + 1;

  -- a non-initial event whose predecessor row does not exist at all
  SELECT count(*) INTO missing_pred
    FROM business.execution_report c
   WHERE c.predecessor_report_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM business.execution_report p WHERE p.id = c.predecessor_report_id);

  -- initial (sequence-1) rows with an invalid shape, or CORRECT/WITHDRAW without a predecessor
  SELECT count(*) INTO bad_initial
    FROM business.execution_report
   WHERE (report_sequence = 1 AND (predecessor_report_id IS NOT NULL OR report_kind <> 'REPORT'))
      OR (report_kind IN ('CORRECT','WITHDRAW') AND predecessor_report_id IS NULL);

  -- a non-initial (sequence>1) row missing its predecessor
  SELECT count(*) INTO missing_on_seq
    FROM business.execution_report
   WHERE report_sequence > 1 AND predecessor_report_id IS NULL;

  IF cross_chain > 0 OR non_adjacent > 0 OR missing_pred > 0 OR bad_initial > 0 OR missing_on_seq > 0 THEN
    RAISE EXCEPTION 'V085 ABORT: corrupt execution_report lineage present (cross_chain=%, non_adjacent=%, missing_pred=%, bad_initial=%, missing_on_seq=%) — refusing to add the lineage FK; reconcile the data first, do not silently rewrite.',
      cross_chain, non_adjacent, missing_pred, bad_initial, missing_on_seq;
  END IF;

  RAISE NOTICE 'V085 lineage audit clean: % execution_report row(s), 0 corrupt — proceeding.', total_rows;
END $$;

-- ── Generated adjacency column: the exact sequence the predecessor MUST occupy (child.seq - 1). GENERATED ALWAYS so it can
-- never be written directly and can never drift from report_sequence. For a sequence-1 row this is 0, but the composite FK
-- below is skipped there because predecessor_report_id IS NULL (MATCH SIMPLE), so the 0 is inert.
ALTER TABLE business.execution_report
  ADD COLUMN IF NOT EXISTS predecessor_report_sequence INTEGER GENERATED ALWAYS AS (report_sequence - 1) STORED;

-- ── FK target: a UNIQUE over the full canonical identity + sequence (id is already the PK, so every tuple is unique; this
-- constraint exists solely to be the composite foreign-key target).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_exr_chain_identity') THEN
    ALTER TABLE business.execution_report
      ADD CONSTRAINT uq_exr_chain_identity UNIQUE (id, founder_id, plan_id, subject_type, subject_id, report_sequence);
  END IF;
END $$;

-- ── Composite self-referential FK — the database guarantee. A non-initial event's predecessor must be a row whose
-- (id, founder_id, plan_id, subject_type, subject_id, report_sequence) equals
-- (predecessor_report_id, THIS founder_id, THIS plan_id, THIS subject_type, THIS subject_id, THIS report_sequence - 1).
-- => predecessor is the SAME founder + EXACT plan revision + SAME subject, exactly one sequence behind (Laws 2, 3, 6).
-- MATCH SIMPLE: when predecessor_report_id IS NULL (a sequence-1 initial event), the FK is not checked. ON DELETE/UPDATE
-- RESTRICT keep the chain immutable (UPDATE is already blocked by exr_no_update; governed account-deletion removes a
-- founder's whole chain in one statement, so no partial-chain delete can violate this).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_exr_predecessor_same_chain') THEN
    ALTER TABLE business.execution_report
      ADD CONSTRAINT fk_exr_predecessor_same_chain
      FOREIGN KEY (predecessor_report_id, founder_id, plan_id, subject_type, subject_id, predecessor_report_sequence)
      REFERENCES business.execution_report (id, founder_id, plan_id, subject_type, subject_id, report_sequence)
      MATCH SIMPLE ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;

COMMENT ON CONSTRAINT fk_exr_predecessor_same_chain ON business.execution_report IS 'ADR-015 Law 2/3/6: a non-initial execution event''s predecessor must be sequence-1 of the IDENTICAL (founder_id, plan_id, subject_type, subject_id) chain. Cross-revision / cross-subject / cross-founder / non-adjacent predecessors are rejected by the database (SQLSTATE 23503), independent of application validation. Sequence-1 initial events (null predecessor) are exempt via MATCH SIMPLE.';
COMMENT ON COLUMN business.execution_report.predecessor_report_sequence IS 'ADR-015 Law 3 (V085): GENERATED ALWAYS AS (report_sequence - 1) — the sequence the predecessor must occupy, used by fk_exr_predecessor_same_chain to enforce adjacency. Never written directly.';
