-- F010 CORRECTION: relay_locked_until on domain_events for SKIP LOCKED pattern
-- Already present in V024. Idempotent add.

ALTER TABLE app.domain_events
  ADD COLUMN IF NOT EXISTS relay_locked_until TIMESTAMPTZ;
