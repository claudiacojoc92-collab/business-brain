CREATE TABLE IF NOT EXISTS cycle.forward_questions (
  id                    TEXT        PRIMARY KEY,
  from_cycle_id         TEXT        NOT NULL REFERENCES cycle.weekly_cycles(id),
  founder_id            TEXT        NOT NULL,
  question              TEXT        NOT NULL,
  target_layer          INTEGER     NOT NULL CHECK (target_layer BETWEEN 1 AND 9),
  priority              TEXT        NOT NULL DEFAULT 'MEDIUM',
  consumed_at           TIMESTAMPTZ,
  consumed_by_cycle_id  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS forward_questions_founder_unconsumed_idx
  ON cycle.forward_questions (founder_id)
  WHERE consumed_at IS NULL;
