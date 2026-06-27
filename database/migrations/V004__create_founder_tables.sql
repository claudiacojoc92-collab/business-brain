CREATE TABLE IF NOT EXISTS founder.founders (
  id                          TEXT        PRIMARY KEY,
  email                       TEXT        NOT NULL,
  name                        TEXT        NOT NULL,
  business_name               TEXT        NOT NULL,
  timezone                    TEXT        NOT NULL DEFAULT 'UTC',
  status                      TEXT        NOT NULL DEFAULT 'CREATED',
  notification_channel        TEXT        NOT NULL DEFAULT 'EMAIL',
  auto_approve_on_window_close BOOLEAN    NOT NULL DEFAULT TRUE,
  approval_window_hours       INTEGER     NOT NULL DEFAULT 72,
  registered_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at                TIMESTAMPTZ,
  paused_at                   TIMESTAMPTZ,
  deleted_at                  TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS founders_email_unique
  ON founder.founders (email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS founders_status_idx
  ON founder.founders (status)
  WHERE deleted_at IS NULL;
