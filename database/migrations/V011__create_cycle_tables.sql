CREATE TABLE IF NOT EXISTS cycle.weekly_cycles (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  cycle_number          INTEGER     NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'PENDING',
  scheduled_for         TIMESTAMPTZ NOT NULL,
  content_deliver_by    TIMESTAMPTZ NOT NULL,
  campaign_id           TEXT,
  campaign_phase_index  INTEGER,
  selected_mode         TEXT,
  started_at            TIMESTAMPTZ,
  reasoning_started_at  TIMESTAMPTZ,
  committed_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  failure_reason        TEXT,
  critique_outcome      TEXT,
  critique_return_count INTEGER     NOT NULL DEFAULT 0,
  is_fallback           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_cycles_founder_number_unique
  ON cycle.weekly_cycles (founder_id, cycle_number);

CREATE INDEX IF NOT EXISTS weekly_cycles_founder_status_idx
  ON cycle.weekly_cycles (founder_id, status);

CREATE INDEX IF NOT EXISTS weekly_cycles_committed_at_idx
  ON cycle.weekly_cycles (founder_id, committed_at DESC)
  WHERE committed_at IS NOT NULL;

-- Enforce one active cycle per founder
CREATE UNIQUE INDEX IF NOT EXISTS weekly_cycles_one_active_per_founder
  ON cycle.weekly_cycles (founder_id)
  WHERE status IN ('COLLECTING','REASONING','CRITIQUE','COMMITTING');
