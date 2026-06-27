CREATE TABLE IF NOT EXISTS founder.recalibration_sessions (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL REFERENCES founder.founders(id),
  recalibration_type    TEXT        NOT NULL,
  triggered_by          TEXT        NOT NULL,
  trigger_reason        TEXT        NOT NULL,
  questions             JSONB       NOT NULL DEFAULT '[]',
  responses             JSONB       NOT NULL DEFAULT '{}',
  expires_at            TIMESTAMPTZ NOT NULL,
  completed_at          TIMESTAMPTZ,
  abandoned_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recalibration_sessions_founder_idx
  ON founder.recalibration_sessions (founder_id);

CREATE INDEX IF NOT EXISTS recalibration_sessions_expires_idx
  ON founder.recalibration_sessions (expires_at)
  WHERE completed_at IS NULL AND abandoned_at IS NULL;
