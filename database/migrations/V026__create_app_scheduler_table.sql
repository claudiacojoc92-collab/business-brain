CREATE TABLE IF NOT EXISTS app.scheduler_state (
  job_name              TEXT        PRIMARY KEY,
  last_run_at           TIMESTAMPTZ,
  next_run_at           TIMESTAMPTZ,
  is_enabled            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app.scheduler_state (job_name, next_run_at) VALUES
  ('WeeklyCycleScheduler',       NOW()),
  ('IntakeExpiryChecker',        NOW()),
  ('RecalibrationExpiryChecker', NOW()),
  ('ApprovalWindowReminder',     NOW()),
  ('ApprovalWindowCloser',       NOW()),
  ('CampaignDurationChecker',    NOW()),
  ('IdempotencyKeyPurger',       NOW()),
  ('CreateMonthlyPartition',     NOW()),
  ('ProjectionHealthChecker',    NOW())
ON CONFLICT (job_name) DO NOTHING;
