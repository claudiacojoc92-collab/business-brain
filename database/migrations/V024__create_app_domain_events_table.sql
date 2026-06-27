-- Transactional outbox (F010)
CREATE TABLE IF NOT EXISTS app.domain_events (
  id                    TEXT        PRIMARY KEY,
  event_type            TEXT        NOT NULL,
  schema_version        INTEGER     NOT NULL DEFAULT 1,
  stream_id             TEXT        NOT NULL,
  event_number          TEXT        NOT NULL,
  emitted_by            TEXT        NOT NULL,
  emitted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id        TEXT        NOT NULL,
  causation_id          TEXT,
  trace_id              TEXT        NOT NULL,
  payload               JSONB       NOT NULL DEFAULT '{}',
  published_at          TIMESTAMPTZ,
  relay_locked_until    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS domain_events_unpublished_idx
  ON app.domain_events (emitted_at ASC)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS domain_events_relay_lock_idx
  ON app.domain_events (relay_locked_until)
  WHERE published_at IS NULL AND relay_locked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS domain_events_stream_idx
  ON app.domain_events (stream_id, event_number);
