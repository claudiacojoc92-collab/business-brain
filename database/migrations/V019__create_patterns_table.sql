CREATE TABLE IF NOT EXISTS memory.patterns (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  layer                 TEXT        NOT NULL,
  domain_concept        TEXT        NOT NULL,
  direction             TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'ACTIVE',
  confidence            NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  observation_count     INTEGER     NOT NULL DEFAULT 0,
  description           TEXT        NOT NULL,
  supporting_event_ids  JSONB       NOT NULL DEFAULT '[]',
  superseded_by_id      TEXT        REFERENCES memory.patterns(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS patterns_founder_layer_idx
  ON memory.patterns (founder_id, layer, status);

CREATE INDEX IF NOT EXISTS patterns_active_idx
  ON memory.patterns (founder_id, confidence DESC)
  WHERE status = 'ACTIVE';
