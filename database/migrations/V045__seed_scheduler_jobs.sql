-- Ensure all scheduler jobs are seeded (idempotent).
-- Already seeded in V026. Re-insert on conflict do nothing.

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
