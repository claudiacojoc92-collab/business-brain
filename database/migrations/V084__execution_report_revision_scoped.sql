-- V084: Strategic Execution Boundary — remediation (ADR-015 amendment). Execution identity must be REVISION-SCOPED, not
-- revision-tagged: the execution chain belongs to the exact immutable Plan revision (plan_id), not the logical plan. Move
-- the chain/effective identity from (founder, plan_logical_id, subject) to (founder, plan_id, subject) so a report on
-- Revision 1's milestone and a report on Revision 2's same milestone id are INDEPENDENT chains (each restarts at
-- sequence 1). Forward-only; does NOT edit V083. Dev has 0 execution rows (test-cleaned) → clean re-key, no data migration;
-- guarded so that if any pre-existing chain spanned revisions the unique index build would fail loudly rather than corrupt.

-- The chain sequence is unique per (founder, EXACT plan revision, subject) — no chain may span revisions.
DROP INDEX IF EXISTS business.uniq_exr_chain_sequence;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_exr_chain_sequence
  ON business.execution_report (founder_id, plan_id, subject_type, subject_id, report_sequence);

-- Effective-state lookup is likewise scoped to the exact plan revision.
DROP INDEX IF EXISTS business.idx_exr_effective;
CREATE INDEX IF NOT EXISTS idx_exr_effective
  ON business.execution_report (founder_id, plan_id, subject_type, subject_id, report_sequence DESC);

-- uniq_exr_predecessor (founder, predecessor_report_id) stays as-is: a global no-fork guard is stricter than per-revision
-- and correctly prevents any two events (even across revisions, which cannot happen) sharing a predecessor.

COMMENT ON COLUMN business.execution_report.plan_id IS 'ADR-015 remediation (V084): the EXACT immutable Plan revision this execution chain belongs to. Execution identity = (founder_id, plan_id, subject_type, subject_id); chains never span revisions. plan_logical_id is retained only as provenance (which logical plan the revision belongs to).';
