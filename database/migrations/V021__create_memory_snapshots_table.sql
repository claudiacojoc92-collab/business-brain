CREATE TABLE IF NOT EXISTS memory.memory_snapshots (
  founder_id            TEXT        PRIMARY KEY,
  snapshot_json         JSONB       NOT NULL DEFAULT '{}',
  estimated_tokens      INTEGER,
  built_from_cycle_id   TEXT,
  built_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
