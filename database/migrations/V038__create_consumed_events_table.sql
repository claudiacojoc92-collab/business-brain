-- Tracks consumed event IDs for consumer idempotency (durable backup for Redis)
CREATE TABLE IF NOT EXISTS app.consumed_events (
  consumer_name         TEXT        NOT NULL,
  event_id              TEXT        NOT NULL,
  consumed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL
    DEFAULT NOW() + INTERVAL '30 days',
  PRIMARY KEY (consumer_name, event_id)
);

CREATE INDEX IF NOT EXISTS consumed_events_expires_idx
  ON app.consumed_events (expires_at);
