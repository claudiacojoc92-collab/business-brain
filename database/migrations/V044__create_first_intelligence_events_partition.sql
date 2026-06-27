-- F006: Ensure at least one partition exists for current period.
-- Partitions were created in V018. This is an idempotent guard.

CREATE TABLE IF NOT EXISTS memory.intelligence_events_2026_07
  PARTITION OF memory.intelligence_events
  FOR VALUES FROM ('2026-07-01') TO ('2027-01-01');
