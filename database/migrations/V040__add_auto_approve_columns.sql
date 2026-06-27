-- F004 CORRECTION: auto_approve_on_window_close and approval_window_hours
-- Already present in V004. This migration adds them if missing (idempotent).

ALTER TABLE founder.founders
  ADD COLUMN IF NOT EXISTS auto_approve_on_window_close BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS approval_window_hours INTEGER NOT NULL DEFAULT 72;
