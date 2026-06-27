CREATE TABLE IF NOT EXISTS campaign.campaigns (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  campaign_type         TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'PLANNED',
  belief_target         TEXT        NOT NULL,
  success_criteria      JSONB       NOT NULL DEFAULT '{}',
  max_duration_weeks    INTEGER     NOT NULL DEFAULT 8,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  interrupted_at        TIMESTAMPTZ,
  interruption_reason   TEXT,
  succeeded_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active campaign per founder
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_one_active_per_founder
  ON campaign.campaigns (founder_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS campaigns_founder_idx
  ON campaign.campaigns (founder_id, status);

CREATE TABLE IF NOT EXISTS campaign.campaign_phases (
  id                        TEXT        PRIMARY KEY,
  campaign_id               TEXT        NOT NULL REFERENCES campaign.campaigns(id),
  founder_id                TEXT        NOT NULL,
  phase_index               INTEGER     NOT NULL,
  mode                      TEXT        NOT NULL,
  belief_target             TEXT        NOT NULL,
  expected_audience_change  TEXT        NOT NULL,
  assigned_cycle_id         TEXT,
  executed_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_phases_campaign_index_unique
  ON campaign.campaign_phases (campaign_id, phase_index);
