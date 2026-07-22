-- V088: Strategic Learning Origination Gate — constitutional completion (ADR-017). Makes the Learning Candidate a proper
-- append-only REVISIONED object with frozen epistemic content, and the founder judgment a four-way append-only log
-- (ADOPT / REJECT / DEFER / WITHDRAW) with exactly one TERMINAL judgment per candidate thread. Editing a candidate creates a
-- NEW revision (history immutable); a predecessor must be the immediately-preceding revision of the SAME founder + SAME
-- logical candidate + SAME source Outcome Review (no fork, no cross-founder/cross-source/non-adjacent predecessor). Admission
-- targets one EXACT candidate revision and only ADOPT creates a learning. Forward-only; edits no earlier migration. dev has
-- 0 rows (audited) → clean restructure.

DO $$
DECLARE n bigint; m bigint;
BEGIN
  SELECT count(*) INTO n FROM business.learning_candidate;
  SELECT count(*) INTO m FROM business.learning_candidate_decision;
  IF n > 0 OR m > 0 THEN RAISE EXCEPTION 'V088 abort: learning_candidate(%) / decision(%) not empty — this restructure expects 0 rows', n, m; END IF;
END $$;

-- ── 1) learning_candidate: revisions + epistemic content ──
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS logical_candidate_id        TEXT;
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS revision                    INTEGER     NOT NULL DEFAULT 1;
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS predecessor_candidate_id    TEXT;
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS predecessor_revision        INTEGER GENERATED ALWAYS AS (revision - 1) STORED;
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS content_hash                TEXT        NOT NULL DEFAULT '';
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS source_outcome_review_revision INTEGER  NOT NULL DEFAULT 1;  -- SOR is immutable → its record id is revision 1
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS source_snapshot_id          TEXT        NOT NULL DEFAULT '';
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS applicability_scope         TEXT        NOT NULL DEFAULT '';
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS epistemic_status            TEXT        NOT NULL DEFAULT '';
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS selected_observations       JSONB       NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS unknown_markers             JSONB       NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS contradiction_markers       JSONB       NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS founder_statement           TEXT        NOT NULL DEFAULT '';
-- narrative + epistemic fields so an ADOPT derives a COMPLETE learning deterministically from the exact revision
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS prior_understanding         TEXT        NOT NULL DEFAULT '';
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS revised_understanding       TEXT        NOT NULL DEFAULT '';
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS change_statement            TEXT        NOT NULL DEFAULT '';
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS learning_category           TEXT        NOT NULL DEFAULT '';
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS is_causal_hypothesis        BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE business.learning_candidate ADD COLUMN IF NOT EXISTS broad_scope_acknowledged    BOOLEAN     NOT NULL DEFAULT false;
-- logical id defaults to the row id for revision-1; drop the temporary text defaults so new inserts must supply real values.
UPDATE business.learning_candidate SET logical_candidate_id = id WHERE logical_candidate_id IS NULL;
ALTER TABLE business.learning_candidate ALTER COLUMN logical_candidate_id SET NOT NULL;
ALTER TABLE business.learning_candidate ALTER COLUMN content_hash DROP DEFAULT;
ALTER TABLE business.learning_candidate ALTER COLUMN source_snapshot_id DROP DEFAULT;
ALTER TABLE business.learning_candidate ALTER COLUMN applicability_scope DROP DEFAULT;
ALTER TABLE business.learning_candidate ALTER COLUMN epistemic_status DROP DEFAULT;
ALTER TABLE business.learning_candidate ALTER COLUMN founder_statement DROP DEFAULT;
ALTER TABLE business.learning_candidate ALTER COLUMN learning_category DROP DEFAULT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lcand_revision_positive') THEN
    ALTER TABLE business.learning_candidate ADD CONSTRAINT lcand_revision_positive CHECK (revision > 0);
  END IF;
  -- revision-1 has no predecessor; every later revision has one (shape).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lcand_revision_shape') THEN
    ALTER TABLE business.learning_candidate ADD CONSTRAINT lcand_revision_shape CHECK (
      (revision = 1 AND predecessor_candidate_id IS NULL) OR (revision > 1 AND predecessor_candidate_id IS NOT NULL)
    );
  END IF;
END $$;

-- one row per (founder, logical candidate, revision); no fork (each predecessor consumed once).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lcand_thread_revision ON business.learning_candidate (founder_id, logical_candidate_id, revision);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lcand_predecessor ON business.learning_candidate (founder_id, predecessor_candidate_id) WHERE predecessor_candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lcand_thread ON business.learning_candidate (founder_id, logical_candidate_id, revision);
-- FK target: full chain identity + sequence (id is PK; this is the composite FK target).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_lcand_chain_identity') THEN
    ALTER TABLE business.learning_candidate ADD CONSTRAINT uq_lcand_chain_identity UNIQUE (id, founder_id, logical_candidate_id, outcome_review_id, revision);
  END IF;
END $$;
-- DATABASE-enforced lineage: a predecessor must be revision-1 of the IDENTICAL (founder, logical candidate, source review)
-- chain. Rejects cross-founder / cross-source / non-adjacent / fork predecessors even under direct SQL (MATCH SIMPLE exempts
-- the null-predecessor revision-1).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_lcand_predecessor_same_chain') THEN
    ALTER TABLE business.learning_candidate ADD CONSTRAINT fk_lcand_predecessor_same_chain
      FOREIGN KEY (predecessor_candidate_id, founder_id, logical_candidate_id, outcome_review_id, predecessor_revision)
      REFERENCES business.learning_candidate (id, founder_id, logical_candidate_id, outcome_review_id, revision)
      MATCH SIMPLE ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;

-- ── 2) learning_candidate_decision: four-way append-only judgment; one TERMINAL per thread; targets an EXACT revision ──
ALTER TABLE business.learning_candidate_decision ADD COLUMN IF NOT EXISTS logical_candidate_id TEXT;
ALTER TABLE business.learning_candidate_decision ADD COLUMN IF NOT EXISTS candidate_revision_id TEXT;  -- the EXACT revision judged
UPDATE business.learning_candidate_decision SET logical_candidate_id = candidate_id, candidate_revision_id = candidate_id WHERE logical_candidate_id IS NULL;
ALTER TABLE business.learning_candidate_decision ALTER COLUMN logical_candidate_id SET NOT NULL;
ALTER TABLE business.learning_candidate_decision ALTER COLUMN candidate_revision_id SET NOT NULL;

ALTER TABLE business.learning_candidate_decision DROP CONSTRAINT IF EXISTS lcdec_verdict_enum;
ALTER TABLE business.learning_candidate_decision DROP CONSTRAINT IF EXISTS lcdec_result_shape;
ALTER TABLE business.learning_candidate_decision ADD CONSTRAINT lcdec_verdict_enum CHECK (verdict IN ('ADOPT','REJECT','DEFER','WITHDRAW'));
-- Only ADOPT yields a learning; the non-adoption judgments create nothing.
ALTER TABLE business.learning_candidate_decision ADD CONSTRAINT lcdec_result_shape CHECK (
  (verdict = 'ADOPT' AND resulting_learning_id IS NOT NULL) OR (verdict <> 'ADOPT' AND resulting_learning_id IS NULL)
);
-- Drop the old one-decision-per-candidate index; DEFER is non-terminal (repeatable), so enforce at most ONE TERMINAL
-- judgment (ADOPT/REJECT/WITHDRAW) per candidate thread — no contradictory terminal judgments.
DROP INDEX IF EXISTS business.uniq_lcdec_candidate;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lcdec_terminal ON business.learning_candidate_decision (founder_id, logical_candidate_id)
  WHERE verdict IN ('ADOPT','REJECT','WITHDRAW');
CREATE INDEX IF NOT EXISTS idx_lcdec_thread ON business.learning_candidate_decision (founder_id, logical_candidate_id, created_at);

COMMENT ON TABLE business.learning_candidate IS 'ADR-017 (V088) — append-only REVISIONED Learning Candidate proposal derived from one exact Outcome Review. Editing creates a new revision (history immutable; no fork; predecessor must be revision-1 of the same founder+logical-candidate+source chain, DB-enforced by fk_lcand_predecessor_same_chain). Carries frozen epistemic content (selected observations, unknowns, contradictions, applicability scope, epistemic status, founder wording) + a SHA-256 content_hash. Creating/editing produces NO learning and NO promotion.';
COMMENT ON TABLE business.learning_candidate_decision IS 'ADR-017 (V088) — append-only four-way founder judgment on an EXACT candidate revision: ADOPT (→ one Strategic Learning), REJECT / WITHDRAW (terminal, no learning), DEFER (non-terminal, candidate stays eligible). At most ONE terminal judgment per candidate thread (uniq_lcdec_terminal); idempotent ADOPT via (founder, idempotency_key).';
