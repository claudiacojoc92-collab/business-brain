-- V062: Durable market-review lifecycle (Wave 3 hardening). The synchronous review (retrieval + LLM
-- inference in-request) is replaced by a DB-authoritative job: create → 202 → poll → terminal. Lease-based
-- claiming survives crashes; a partial unique index makes duplicate submissions idempotent; findings link to
-- the review that produced them (lineage); a failed refresh never removes the prior successful review's
-- findings. internal_error_detail is internal-only. No FK cascade (delete coverage explicit).

CREATE TABLE IF NOT EXISTS business.market_review (
  id                        TEXT        PRIMARY KEY,
  founder_id                TEXT        NOT NULL,
  market_entity_id          TEXT        NOT NULL,
  status                    TEXT        NOT NULL,            -- QUEUED|RETRIEVING|EXTRACTING|INFERRING|READY|INSUFFICIENT_EVIDENCE|FAILED
  attempt_count             INT         NOT NULL DEFAULT 1,
  max_attempts              INT         NOT NULL DEFAULT 3,
  claimed_at                TIMESTAMPTZ,
  lease_expires_at          TIMESTAMPTZ,
  started_at                TIMESTAMPTZ,
  finished_at               TIMESTAMPTZ,
  failure_category          TEXT,                            -- ROBOTS_BLOCKED|UNREACHABLE|UNSUPPORTED_CONTENT|INSUFFICIENT_READABLE_EVIDENCE|RETRIEVAL_FAILED|INFERENCE_FAILED
  founder_safe_error        TEXT,
  internal_error_detail     TEXT,                            -- internal-only, never surfaced
  prior_successful_review_id TEXT,                           -- the last READY review at create time (lineage)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one ACTIVE review per (founder, entity) — idempotent duplicate submission.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_market_review
  ON business.market_review (founder_id, market_entity_id)
  WHERE status IN ('QUEUED', 'RETRIEVING', 'EXTRACTING', 'INFERRING');
CREATE INDEX IF NOT EXISTS idx_market_review_entity ON business.market_review (founder_id, market_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_review_claim ON business.market_review (status, lease_expires_at);

-- Findings link to the review that produced them (lineage; latest-successful-review view).
ALTER TABLE business.market_finding ADD COLUMN IF NOT EXISTS review_id TEXT;

COMMENT ON TABLE business.market_review IS 'Wave 3 durable market-review runs. DB authoritative; lease claiming survives crashes; findings finalize atomically with READY; precise failure taxonomy.';
