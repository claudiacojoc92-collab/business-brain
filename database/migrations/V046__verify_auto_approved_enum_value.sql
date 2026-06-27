-- F004 CORRECTION: Verify AUTO_APPROVED is in approval_status domain.
-- bb_types enums use TEXT in V1 (Kysely does not enforce enum types at DB level).
-- This migration is a documentation marker — no DDL required.

COMMENT ON TABLE founder.founders IS
  'approval_status domain: AWAITING_APPROVAL, APPROVED, APPROVED_WITH_EDITS, REJECTED, AUTO_APPROVED';
