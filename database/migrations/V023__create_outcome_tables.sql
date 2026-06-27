CREATE TABLE IF NOT EXISTS outcome.outcome_reports (
  id                      TEXT        PRIMARY KEY,
  founder_id              TEXT        NOT NULL,
  outcome_type            TEXT        NOT NULL,
  description             TEXT,
  is_implicit             BOOLEAN     NOT NULL DEFAULT FALSE,
  attribution_status      TEXT        NOT NULL DEFAULT 'REPORTED',
  attribution_confidence  NUMERIC(4,3),
  preceding_cycle_ids     JSONB       NOT NULL DEFAULT '[]',
  preceding_modes         JSONB       NOT NULL DEFAULT '[]',
  confirmed_at            TIMESTAMPTZ,
  reported_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outcome_reports_founder_idx
  ON outcome.outcome_reports (founder_id, reported_at DESC);

CREATE INDEX IF NOT EXISTS outcome_reports_attribution_idx
  ON outcome.outcome_reports (founder_id, attribution_status)
  WHERE attribution_status = 'PENDING';
