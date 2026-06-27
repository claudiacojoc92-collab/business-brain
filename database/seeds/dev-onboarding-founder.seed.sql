-- ================================================================
-- database/seeds/dev-onboarding-founder.seed.sql
--
-- Seeds a single founder in INTAKE_PENDING status with an active
-- intake session, to verify the B1 onboarding flow end-to-end
-- without going through registration first.
--
-- Credentials:
--   email:    onboarding@dev.businessbrain.ai
--   password: devpassword123   (bcrypt hash below — DEV ONLY)
--
-- Usage:
--   psql "$DATABASE_URL" -f database/seeds/dev-onboarding-founder.seed.sql
--
-- Idempotent — ON CONFLICT DO NOTHING.
-- Matches the real schema (V004 founders, V005 intake_sessions, V034 founder_auth).
-- ================================================================

BEGIN;

-- ── 1. Founder in INTAKE_PENDING ────────────────────────────────────────────
INSERT INTO founder.founders (
  id, email, name, business_name, timezone, status,
  notification_channel, auto_approve_on_window_close, approval_window_hours,
  registered_at, activated_at
) VALUES (
  '01HDEVONBOARDINGFOUNDER0001',
  'onboarding@dev.businessbrain.ai',
  'Dev Onboarding',
  'Business Brain Dev',
  'Europe/Bucharest',
  'INTAKE_PENDING',
  'EMAIL',
  TRUE,
  72,
  NOW(),
  NULL                                  -- activated_at: NULL until CompleteIntake
) ON CONFLICT (id) DO NOTHING;

-- ── 2. Auth credentials (bcrypt hash of 'devpassword123') ────────────────────
INSERT INTO app.founder_auth (founder_id, password_hash)
VALUES (
  '01HDEVONBOARDINGFOUNDER0001',
  '$2b$12$mP8e6h/ig/5OviobYIDtROqO5v9wroLbPMyNAxKghLfdJCQrvzBRa'
) ON CONFLICT (founder_id) DO NOTHING;

-- ── 3. Active intake session (empty signals, 28 mandatory types) ─────────────
INSERT INTO founder.intake_sessions (
  id, founder_id, signals, mandatory_signal_types, expires_at,
  completed_at, abandoned_at
) VALUES (
  '01HDEVONBOARDINGSESSION0001',
  '01HDEVONBOARDINGFOUNDER0001',
  '{}'::jsonb,
  '[
    "CONVICTION_MECHANISM","FOUNDING_STORY","BELIEF_TARGET",
    "CONVICTION_FALSIFICATION","EDUCATION_INSIGHT","CONTRARIAN_POSITION",
    "VOICE_OPENING_EXAMPLE","VOICE_REJECTION_EXAMPLE","VOICE_SYNONYM",
    "VOICE_CTA_EXAMPLE","VOICE_ANALOGY","CONTENT_HARD_BLOCK",
    "AUDIENCE_INTERNAL_MONOLOGUE","AUDIENCE_SOCIAL_FRAMING",
    "AUDIENCE_SELF_PROTECTION","WARM_SIGNAL_VOCABULARY",
    "COLD_SIGNAL_VOCABULARY","AUDIENCE_FALSE_ASSUMPTION",
    "OFFER_NATURAL_LANGUAGE","OFFER_PRICE_PHILOSOPHY",
    "PRIMARY_OBJECTION","OBJECTION_RESPONSE",
    "APPROVAL_STANDARD_POSITIVE","APPROVAL_STANDARD_NEGATIVE",
    "ZERO_EDIT_CRITERIA","INTENDED_AUDIENCE_MOVEMENT",
    "UNSOLICITED_HIGH_VALUE","TRUST_CRITERIA"
  ]'::jsonb,
  NOW() + INTERVAL '7 days',
  NULL,
  NULL
) ON CONFLICT (id) DO NOTHING;

COMMIT;
