CREATE TABLE IF NOT EXISTS founder.intake_sessions (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL REFERENCES founder.founders(id),
  signals               JSONB       NOT NULL DEFAULT '{}',
  mandatory_signal_types JSONB      NOT NULL DEFAULT '[]',
  expires_at            TIMESTAMPTZ NOT NULL,
  completed_at          TIMESTAMPTZ,
  abandoned_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intake_sessions_founder_idx
  ON founder.intake_sessions (founder_id);

CREATE INDEX IF NOT EXISTS intake_sessions_expires_idx
  ON founder.intake_sessions (expires_at)
  WHERE completed_at IS NULL AND abandoned_at IS NULL;
