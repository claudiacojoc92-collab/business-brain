CREATE TABLE IF NOT EXISTS app.prompt_registry (
  prompt_id             TEXT        PRIMARY KEY,
  system_template       TEXT        NOT NULL,
  user_template         TEXT        NOT NULL DEFAULT '',
  model_tier            TEXT        NOT NULL DEFAULT 'MEDIUM',
  max_completion_tokens INTEGER     NOT NULL DEFAULT 1000,
  validation_hash       TEXT        NOT NULL,
  version               INTEGER     NOT NULL DEFAULT 1,
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  description           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prompt_registry_active_idx
  ON app.prompt_registry (prompt_id)
  WHERE is_active = TRUE;
