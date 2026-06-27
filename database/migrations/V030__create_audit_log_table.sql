CREATE TABLE IF NOT EXISTS audit.audit_log (
  id                    TEXT        PRIMARY KEY,
  actor_id              TEXT,
  actor_role            TEXT,
  event_type            TEXT        NOT NULL,
  resource_type         TEXT,
  resource_id           TEXT,
  trace_id              TEXT,
  correlation_id        TEXT,
  ip_address            TEXT,
  success               BOOLEAN     NOT NULL DEFAULT TRUE,
  error_code            TEXT,
  metadata              JSONB       NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit.audit_log (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_resource_idx
  ON audit.audit_log (resource_type, resource_id, created_at DESC)
  WHERE resource_id IS NOT NULL;
