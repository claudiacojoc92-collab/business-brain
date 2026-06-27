CREATE TABLE IF NOT EXISTS app.notification_log (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  notification_type     TEXT        NOT NULL,
  channel               TEXT        NOT NULL,
  triggering_event_id   TEXT,
  status                TEXT        NOT NULL DEFAULT 'PENDING',
  attempt_count         INTEGER     NOT NULL DEFAULT 0,
  last_attempt_at       TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_log_idempotency_idx
  ON app.notification_log (founder_id, triggering_event_id, notification_type)
  WHERE triggering_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notification_log_founder_idx
  ON app.notification_log (founder_id, created_at DESC);
