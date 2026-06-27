CREATE TABLE IF NOT EXISTS app.idempotency_keys (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  key                   TEXT        NOT NULL,
  response_status       INTEGER     NOT NULL,
  response_body         JSONB       NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL
    DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_founder_key_unique
  ON app.idempotency_keys (founder_id, key);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx
  ON app.idempotency_keys (expires_at);
