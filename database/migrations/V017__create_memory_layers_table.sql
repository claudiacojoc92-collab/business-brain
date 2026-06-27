CREATE TABLE IF NOT EXISTS memory.memory_layers (
  founder_id            TEXT        NOT NULL,
  layer                 TEXT        NOT NULL,
  payload               JSONB       NOT NULL DEFAULT '{}',
  confidence            NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  data_points           INTEGER     NOT NULL DEFAULT 0,
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_cycle_id         TEXT,
  PRIMARY KEY (founder_id, layer)
);

CREATE INDEX IF NOT EXISTS memory_layers_confidence_idx
  ON memory.memory_layers (founder_id, confidence DESC);
