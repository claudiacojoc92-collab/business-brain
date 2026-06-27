CREATE TABLE IF NOT EXISTS cycle.content_delivery_log (
  id                    TEXT        PRIMARY KEY,
  cycle_id              TEXT        NOT NULL REFERENCES cycle.weekly_cycles(id),
  founder_id            TEXT        NOT NULL,
  content_piece_id      TEXT,
  delivery_channel      TEXT        NOT NULL,
  delivered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_status       TEXT        NOT NULL DEFAULT 'DELIVERED'
);

CREATE INDEX IF NOT EXISTS content_delivery_log_cycle_idx
  ON cycle.content_delivery_log (cycle_id);
