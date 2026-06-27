CREATE TABLE IF NOT EXISTS cycle.cycle_signals (
  id                    TEXT        PRIMARY KEY,
  cycle_id              TEXT        NOT NULL REFERENCES cycle.weekly_cycles(id),
  founder_id            TEXT        NOT NULL,
  signal_type           TEXT        NOT NULL,
  typed_concept         TEXT,
  direction             TEXT,
  value_numeric         NUMERIC,
  value_text            TEXT,
  significance_score    NUMERIC(4,3),
  source_reference      TEXT        NOT NULL DEFAULT 'FOUNDER_SUBMITTED',
  collected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cycle_signals_cycle_idx
  ON cycle.cycle_signals (cycle_id);

CREATE INDEX IF NOT EXISTS cycle_signals_founder_idx
  ON cycle.cycle_signals (founder_id);
