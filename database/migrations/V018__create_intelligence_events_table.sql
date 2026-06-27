-- Partitioned table for intelligence events (F006)
CREATE TABLE IF NOT EXISTS memory.intelligence_events (
  id                    TEXT        NOT NULL,
  founder_id            TEXT        NOT NULL,
  cycle_id              TEXT,
  layer                 TEXT        NOT NULL,
  event_type            TEXT        NOT NULL,
  content               JSONB       NOT NULL DEFAULT '{}',
  confidence            NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  reasoning             TEXT,
  confidence_direction  TEXT,
  confidence_delta      NUMERIC(5,4),
  source_signal_ids     JSONB       NOT NULL DEFAULT '[]',
  replaces_pattern_id   TEXT,
  quarantine_status     TEXT        NOT NULL DEFAULT 'APPLIED',
  emitted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at            TIMESTAMPTZ,
  PRIMARY KEY (id, emitted_at)
) PARTITION BY RANGE (emitted_at);

-- Create initial partition for current quarter
CREATE TABLE IF NOT EXISTS memory.intelligence_events_2025_01
  PARTITION OF memory.intelligence_events
  FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE TABLE IF NOT EXISTS memory.intelligence_events_2025_04
  PARTITION OF memory.intelligence_events
  FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');

CREATE TABLE IF NOT EXISTS memory.intelligence_events_2025_07
  PARTITION OF memory.intelligence_events
  FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');

CREATE TABLE IF NOT EXISTS memory.intelligence_events_2025_10
  PARTITION OF memory.intelligence_events
  FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS memory.intelligence_events_2026_01
  PARTITION OF memory.intelligence_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');

-- Index on each partition (created on parent, applies to all partitions)
CREATE INDEX IF NOT EXISTS intelligence_events_founder_layer_idx
  ON memory.intelligence_events (founder_id, layer, emitted_at DESC);

CREATE INDEX IF NOT EXISTS intelligence_events_quarantine_idx
  ON memory.intelligence_events (founder_id, quarantine_status)
  WHERE quarantine_status = 'QUARANTINED';

-- Immutability trigger: prevent UPDATE or DELETE
CREATE OR REPLACE FUNCTION memory.prevent_ie_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intelligence_events is append-only. UPDATE and DELETE are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ie_update ON memory.intelligence_events;
CREATE TRIGGER trg_prevent_ie_update
  BEFORE UPDATE OR DELETE ON memory.intelligence_events
  FOR EACH ROW EXECUTE FUNCTION memory.prevent_ie_mutation();
