-- V059: Durable understanding-generation lifecycle (Wave 2 closure). The authoritative run state lives in
-- the DB (never an in-memory set). A partial unique index enforces ONE active run per (founder, source), so
-- duplicate submissions are idempotent. Claiming uses claimed_at + lease_expires_at so a crashed worker's
-- run becomes reclaimable (stale-lease recovery) rather than stranded. error_detail is INTERNAL only —
-- never sent to the founder; error_code is the founder-legible category.

CREATE TABLE IF NOT EXISTS business.understanding_run (
  id                    TEXT        PRIMARY KEY,                 -- ULID
  founder_id            TEXT        NOT NULL,
  source_key            TEXT        NOT NULL,                    -- normalized source identity (url or 'existing-evidence')
  status                TEXT        NOT NULL,                    -- QUEUED|INGESTING|ANALYZING|SYNTHESIZING|READY|FAILED
  attempt_count         INT         NOT NULL DEFAULT 0,
  claimed_at            TIMESTAMPTZ,
  lease_expires_at      TIMESTAMPTZ,                             -- an active run past this is stale → reclaimable
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  error_code            TEXT,                                    -- founder-legible category
  error_detail          TEXT,                                   -- INTERNAL diagnostic (never surfaced)
  understanding_id      TEXT,                                   -- set when READY
  understanding_version INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one ACTIVE run per (founder, source): idempotent duplicate submission returns the existing run.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_understanding_run
  ON business.understanding_run (founder_id, source_key)
  WHERE status IN ('QUEUED', 'INGESTING', 'ANALYZING', 'SYNTHESIZING');

CREATE INDEX IF NOT EXISTS idx_understanding_run_founder ON business.understanding_run (founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_understanding_run_claim ON business.understanding_run (status, lease_expires_at);

COMMENT ON TABLE business.understanding_run IS
  'Wave 2 durable understanding-generation runs. DB is the source of truth; lease-based claiming survives crashes; a partial unique index makes duplicate submissions idempotent. error_detail is internal-only.';
