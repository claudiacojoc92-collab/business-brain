CREATE TABLE IF NOT EXISTS app.process_manager_state (
  id                    TEXT        PRIMARY KEY,
  process_manager_name  TEXT        NOT NULL,
  founder_id            TEXT        NOT NULL,
  state                 JSONB       NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS process_manager_state_unique
  ON app.process_manager_state (process_manager_name, founder_id);
