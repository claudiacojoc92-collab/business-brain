-- V075: Slice 6 — record the one bounded TARGETED CONSTRAINED REPAIR phase on the carousel safety trace.
-- UNSHIPPED (feature/business-brain-v1). After the constrained fallback fails a LOCAL gate, at most one
-- block-scoped repair may rewrite only the failing block(s); everything else stays byte-identical. This column
-- captures whether it was triggered, the per-block gate class + before/after hashes + preserved meaning refs,
-- and the outcome (persisted / fail_closed / not_repairable). Additive; existing rows default to NULL (no repair).
-- No new audit system — same trace table.

ALTER TABLE workspace.carousel_safety_trace
  ADD COLUMN IF NOT EXISTS targeted_repair JSONB;
