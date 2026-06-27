-- Additional performance indexes beyond the primary ones

-- Cycle history lookback for attribution
CREATE INDEX IF NOT EXISTS weekly_cycles_founder_committed_mode_idx
  ON cycle.weekly_cycles (founder_id, committed_at DESC, selected_mode)
  WHERE committed_at IS NOT NULL;

-- Intelligence events partition pruning helper
CREATE INDEX IF NOT EXISTS intelligence_events_founder_emitted_idx
  ON memory.intelligence_events (founder_id, emitted_at DESC);

-- Outcome attribution lookback
CREATE INDEX IF NOT EXISTS outcome_reports_founder_reported_idx
  ON outcome.outcome_reports (founder_id, reported_at DESC);

-- Notification deduplication
CREATE INDEX IF NOT EXISTS notification_log_status_idx
  ON app.notification_log (status, created_at DESC)
  WHERE status IN ('PENDING', 'FAILED');
