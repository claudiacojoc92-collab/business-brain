-- V077: Strategic Learning Record enrichment (remediation of the SLR slice — still CREATE-only, still append-only).
-- Forward-only ALTER of business.strategic_learning_record (V076 is NOT edited). Adds the fields that make a learning an
-- honest durable-understanding object: before/after understanding + change statement; applicability scope + broad-scope
-- acknowledgement; causal-hypothesis flag; boundary conditions, counterevidence, unresolved unknowns; source-classified
-- observations; and evidence references restricted (in code) to the review's own lineage. Also migrates the confidence
-- vocabulary away from the truth-inflating ESTABLISHED to a bounded set (PROVISIONAL|SUPPORTED|CONTESTED|
-- INSUFFICIENT_INFORMATION). No production rows exist for this unpushed table; the value mapping is defensive.
-- The append-only slr_no_update trigger (V076) still forbids UPDATE after commit; these ALTERs are DDL, not row UPDATEs.

ALTER TABLE business.strategic_learning_record
  ADD COLUMN IF NOT EXISTS prior_understanding        TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS revised_understanding      TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS change_statement           TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS learning_scope             TEXT        NOT NULL DEFAULT 'OTHER',
  ADD COLUMN IF NOT EXISTS broad_scope_acknowledged   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_causal_hypothesis       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS boundary_conditions        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS counter_evidence           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unresolved_unknowns        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS observations               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_references        JSONB       NOT NULL DEFAULT '[]'::jsonb;

-- Map any pre-existing confidence values to the bounded vocabulary (defensive; no rows expected).
UPDATE business.strategic_learning_record SET confidence = 'SUPPORTED'   WHERE confidence = 'ESTABLISHED';
UPDATE business.strategic_learning_record SET confidence = 'PROVISIONAL' WHERE confidence = 'TENTATIVE';
UPDATE business.strategic_learning_record SET confidence = 'SUPPORTED'   WHERE confidence = 'CONDITIONAL';

COMMENT ON COLUMN business.strategic_learning_record.prior_understanding IS 'FOUNDER_AUTHORED — what the founder understood before this review (kept separate from revised).';
COMMENT ON COLUMN business.strategic_learning_record.revised_understanding IS 'FOUNDER_AUTHORED — what the founder understands now.';
COMMENT ON COLUMN business.strategic_learning_record.change_statement IS 'FOUNDER_AUTHORED — what actually changed in the understanding.';
COMMENT ON COLUMN business.strategic_learning_record.learning_scope IS 'FOUNDER_AUTHORED — applicability scope; broad scopes require broad_scope_acknowledged.';
COMMENT ON COLUMN business.strategic_learning_record.is_causal_hypothesis IS 'FOUNDER_AUTHORED — a causal claim from founder-reported material alone cannot be SUPPORTED (deterministic guard).';
COMMENT ON COLUMN business.strategic_learning_record.confidence IS 'FOUNDER_AUTHORED — bounded epistemic state PROVISIONAL|SUPPORTED|CONTESTED|INSUFFICIENT_INFORMATION; never objective/absolute truth (Law 9).';
