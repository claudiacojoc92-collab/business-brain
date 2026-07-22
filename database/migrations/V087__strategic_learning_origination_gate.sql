-- V087: Strategic Learning Origination Gate (ADR-017, SOR-1). A Strategic Learning may originate two ways, both explicit and
-- never generic: (1) PLAN_REVIEW — directly from a Strategic Plan Review (unchanged); (2) OUTCOME_REVIEW — via a gated path
-- Strategic Outcome Review → Learning Candidate → explicit founder judgment (ACCEPT) → Strategic Learning. A Learning
-- Candidate is an append-only immutable PROPOSAL derived from one exact Outcome Review; creating it produces NO learning and
-- NO promotion. A candidate is decided at most once (ACCEPT/DISMISS, no-fork); only ACCEPT creates a learning; nothing
-- auto-promotes. Every learning records an explicit, unambiguous origin (CHECK-enforced). Forward-only; edits no earlier
-- migration; append-only triggers mirror V076/V086.

-- ── 1) Learning Candidate — the immutable proposal derived from an exact Outcome Review ──
CREATE TABLE IF NOT EXISTS business.learning_candidate (
  id                          TEXT        PRIMARY KEY,
  founder_id                  TEXT        NOT NULL,
  outcome_review_id           TEXT        NOT NULL,   -- the EXACT Strategic Outcome Review this candidate is derived from
  outcome_review_content_hash TEXT        NOT NULL,   -- frozen provenance (the SOR's reproducible content hash)
  plan_record_id              TEXT        NOT NULL,   -- plan lineage frozen by the SOR
  plan_logical_id             TEXT        NOT NULL,
  plan_revision               INTEGER     NOT NULL,
  commitment_record_id        TEXT        NOT NULL,
  source_observed_outcome     TEXT        NOT NULL,   -- the SOR's observed outcome (incl. UNKNOWN)
  candidate_statement         TEXT        NOT NULL,   -- the founder's proposed learning (a proposal, not a learning)
  candidate_rationale         TEXT,
  schema_version              TEXT        NOT NULL,
  idempotency_key             TEXT        NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lcand_founder_idempotency ON business.learning_candidate (founder_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_lcand_review ON business.learning_candidate (founder_id, outcome_review_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lcand_founder ON business.learning_candidate (founder_id, created_at DESC);

-- ── 2) Learning Candidate Decision — the explicit, one-time founder judgment (ACCEPT/DISMISS) ──
CREATE TABLE IF NOT EXISTS business.learning_candidate_decision (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  candidate_id          TEXT        NOT NULL,
  verdict               TEXT        NOT NULL,   -- ACCEPT | DISMISS
  founder_judgment      TEXT        NOT NULL,   -- the founder's explicit words
  resulting_learning_id TEXT,                   -- the created Strategic Learning (only on ACCEPT)
  idempotency_key       TEXT        NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lcdec_verdict_enum') THEN
    ALTER TABLE business.learning_candidate_decision ADD CONSTRAINT lcdec_verdict_enum CHECK (verdict IN ('ACCEPT','DISMISS'));
  END IF;
  -- ACCEPT must carry the resulting learning; DISMISS must not.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lcdec_result_shape') THEN
    ALTER TABLE business.learning_candidate_decision ADD CONSTRAINT lcdec_result_shape CHECK (
      (verdict = 'ACCEPT'  AND resulting_learning_id IS NOT NULL)
      OR (verdict = 'DISMISS' AND resulting_learning_id IS NULL)
    );
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lcdec_founder_idempotency ON business.learning_candidate_decision (founder_id, idempotency_key);
-- No-fork: a candidate is decided AT MOST ONCE.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lcdec_candidate ON business.learning_candidate_decision (founder_id, candidate_id);

-- ── 3) Strategic Learning origin discriminator — every learning records exactly one unambiguous origin ──
DO $$
DECLARE bad bigint;
BEGIN
  -- data audit: every existing learning must have a plan-review lineage (review_record_id) to become PLAN_REVIEW cleanly.
  SELECT count(*) INTO bad FROM business.strategic_learning_record WHERE review_record_id IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'V087 abort: % existing learning row(s) have a NULL review_record_id — reconcile before adding the origin CHECK', bad; END IF;
END $$;

ALTER TABLE business.strategic_learning_record ALTER COLUMN review_record_id DROP NOT NULL;   -- OUTCOME_REVIEW origin has no plan review
ALTER TABLE business.strategic_learning_record ALTER COLUMN review_revision  DROP NOT NULL;
ALTER TABLE business.strategic_learning_record ADD COLUMN IF NOT EXISTS learning_origin      TEXT NOT NULL DEFAULT 'PLAN_REVIEW';
ALTER TABLE business.strategic_learning_record ADD COLUMN IF NOT EXISTS outcome_review_id    TEXT;
ALTER TABLE business.strategic_learning_record ADD COLUMN IF NOT EXISTS learning_candidate_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slr_origin_enum') THEN
    ALTER TABLE business.strategic_learning_record ADD CONSTRAINT slr_origin_enum CHECK (learning_origin IN ('PLAN_REVIEW','OUTCOME_REVIEW'));
  END IF;
  -- Exactly one unambiguous origin: PLAN_REVIEW ⇒ no outcome/candidate refs; OUTCOME_REVIEW ⇒ both refs present + no plan review.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'slr_origin_consistency') THEN
    ALTER TABLE business.strategic_learning_record ADD CONSTRAINT slr_origin_consistency CHECK (
      (learning_origin = 'PLAN_REVIEW'   AND outcome_review_id IS NULL     AND learning_candidate_id IS NULL     AND review_record_id IS NOT NULL)
      OR (learning_origin = 'OUTCOME_REVIEW' AND outcome_review_id IS NOT NULL AND learning_candidate_id IS NOT NULL AND review_record_id IS NULL)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_slr_origin ON business.strategic_learning_record (founder_id, learning_origin);
CREATE INDEX IF NOT EXISTS idx_slr_outcome_review ON business.strategic_learning_record (founder_id, outcome_review_id);

-- ── Append-only triggers for both new ledgers (BEFORE-UPDATE forbidden; individual DELETE gated on the same GUC) ──
CREATE OR REPLACE FUNCTION business.lcand_forbid_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'learning_candidate is append-only: UPDATE is forbidden'; END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION business.lcand_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_learning_candidate_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'learning_candidate is append-only: individual DELETE is forbidden (only founder-account deletion may remove candidates)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS lcand_no_update ON business.learning_candidate;
CREATE TRIGGER lcand_no_update BEFORE UPDATE ON business.learning_candidate FOR EACH ROW EXECUTE FUNCTION business.lcand_forbid_update();
DROP TRIGGER IF EXISTS lcand_no_delete ON business.learning_candidate;
CREATE TRIGGER lcand_no_delete BEFORE DELETE ON business.learning_candidate FOR EACH ROW EXECUTE FUNCTION business.lcand_forbid_delete();

DROP TRIGGER IF EXISTS lcdec_no_update ON business.learning_candidate_decision;
CREATE TRIGGER lcdec_no_update BEFORE UPDATE ON business.learning_candidate_decision FOR EACH ROW EXECUTE FUNCTION business.lcand_forbid_update();
DROP TRIGGER IF EXISTS lcdec_no_delete ON business.learning_candidate_decision;
CREATE TRIGGER lcdec_no_delete BEFORE DELETE ON business.learning_candidate_decision FOR EACH ROW EXECUTE FUNCTION business.lcand_forbid_delete();

COMMENT ON TABLE business.learning_candidate IS 'ADR-017 Strategic Learning Origination Gate — append-only immutable PROPOSAL that a retrospective (Strategic Outcome Review) might be worth keeping. Creating it produces NO learning and NO promotion; it becomes a Strategic Learning only via an explicit founder ACCEPT (learning_candidate_decision).';
COMMENT ON COLUMN business.strategic_learning_record.learning_origin IS 'ADR-017: PLAN_REVIEW (from a Strategic Plan Review, unchanged) or OUTCOME_REVIEW (from a Strategic Outcome Review via a Learning Candidate + explicit founder ACCEPT). CHECK slr_origin_consistency ties each learning to exactly one unambiguous origin — no generic review source.';
