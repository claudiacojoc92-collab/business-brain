-- M7 — founder-test observability. A single, additive, append-only stream of FOUNDER-BEHAVIOR events
-- (distinct from app.domain_events which is the internal CQRS bus, and audit.audit_log which is security audit).
-- Purpose: after a founder tests the deployed MVP unattended, Claudia can query "did they reach first value,
-- adopt strategy, export an asset, use Talk, where did they stall" — queryable truth, not charts.
-- Metadata is bounded and non-sensitive (no page dumps, no PII, no secrets, no model prompts).

CREATE TABLE IF NOT EXISTS app.founder_event (
  id           text        PRIMARY KEY,
  account_id   text        NOT NULL,
  business_id  text        NULL,
  event_type   text        NOT NULL,
  surface      text        NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb
);

-- Query paths: per-account funnel over time, per-business journey, per-event-type rollups.
CREATE INDEX IF NOT EXISTS idx_founder_event_account  ON app.founder_event (account_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_founder_event_business ON app.founder_event (business_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_founder_event_type     ON app.founder_event (event_type, occurred_at);
