CREATE TABLE IF NOT EXISTS app.founder_status_projection (
  founder_id            TEXT        PRIMARY KEY,
  status                TEXT        NOT NULL,
  name                  TEXT        NOT NULL,
  business_name         TEXT        NOT NULL,
  timezone              TEXT        NOT NULL DEFAULT 'UTC',
  activated_at          TIMESTAMPTZ,
  paused_at             TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.current_cycle_projection (
  founder_id            TEXT        PRIMARY KEY,
  cycle_id              TEXT        NOT NULL,
  cycle_number          INTEGER     NOT NULL,
  status                TEXT        NOT NULL,
  selected_mode         TEXT,
  is_fallback           BOOLEAN     NOT NULL DEFAULT FALSE,
  committed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.campaign_projection (
  campaign_id           TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  campaign_type         TEXT        NOT NULL,
  status                TEXT        NOT NULL,
  belief_target         TEXT        NOT NULL,
  phases_completed      INTEGER     NOT NULL DEFAULT 0,
  total_phases          INTEGER     NOT NULL DEFAULT 0,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_projection_founder_active_idx
  ON app.campaign_projection (founder_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS app.outcome_history_projection (
  outcome_id            TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  outcome_type          TEXT        NOT NULL,
  attribution_status    TEXT        NOT NULL,
  reported_at           TIMESTAMPTZ NOT NULL,
  confirmed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outcome_history_projection_founder_idx
  ON app.outcome_history_projection (founder_id, reported_at DESC);

CREATE TABLE IF NOT EXISTS app.pattern_projection (
  pattern_id            TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  layer                 TEXT        NOT NULL,
  domain_concept        TEXT        NOT NULL,
  direction             TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'ACTIVE',
  confidence            NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  observation_count     INTEGER     NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pattern_projection_founder_active_idx
  ON app.pattern_projection (founder_id, layer)
  WHERE status = 'ACTIVE';
