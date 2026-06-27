-- Development seed: one complete ACTIVE founder for local testing
-- Run after migrations: psql $DATABASE_URL < database/seeds/dev-founder.seed.sql

BEGIN;

-- Founder
INSERT INTO founder.founders (
  id, email, name, business_name, timezone, status,
  notification_channel, auto_approve_on_window_close,
  approval_window_hours, registered_at, activated_at
) VALUES (
  '01HDEV000000000000000FOUNDER',
  'dev@businessbrain.ai',
  'Dev Founder',
  'Dev Business',
  'Europe/London',
  'ACTIVE',
  'EMAIL',
  TRUE,
  72,
  '2025-01-01T00:00:00Z',
  '2025-01-06T04:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- Voice version
INSERT INTO founder.voice_versions (
  id, founder_id, version_number, derived_from,
  sentence_rhythm, opening_pattern, closing_pattern,
  conviction_posture, vulnerability_level, specificity_level,
  cta_style, is_current
) VALUES (
  '01HDEV000000000000000VVOICE1',
  '01HDEV000000000000000FOUNDER',
  1, 'INTAKE',
  'SHORT_DECLARATIVE',
  'Let me be direct.',
  'The choice is yours.',
  'OPINION_FIRST',
  'LOW',
  'ALWAYS_SPECIFIC',
  'INVITATION',
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- Audience
INSERT INTO founder.audiences (
  id, founder_id, description, pre_engagement_state,
  sophistication_level, primary_platform, is_current
) VALUES (
  '01HDEV000000000000000AUDIENC',
  '01HDEV000000000000000FOUNDER',
  'Service-based professionals seeking consistent clients.',
  'Overwhelmed by inconsistent leads.',
  'GROWTH',
  'INSTAGRAM',
  TRUE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO founder.audience_language_fingerprints (
  id, audience_id, version_number, primary_phrases,
  avoid_phrases, emotional_register, failed_alternatives
) VALUES (
  '01HDEV000000000000000ALFINGE',
  '01HDEV000000000000000AUDIENC',
  1,
  '["consistent clients","scalable business","clear strategy"]',
  '["hustle","grind","crush it"]',
  'ASPIRATIONAL',
  '["cold outreach","paid ads","content mills"]'
) ON CONFLICT (id) DO NOTHING;

-- Offer
INSERT INTO founder.offer_versions (
  id, founder_id, version_number, name, primary_promise,
  price_tier, sales_mechanism, maturity, availability,
  capacity_available, is_current
) VALUES (
  '01HDEV000000000000000OFFER01',
  '01HDEV000000000000000FOUNDER',
  1,
  'Marketing Clarity Package',
  'Consistent clients without constant hustle.',
  'MID',
  'DISCOVERY_CALL',
  'ESTABLISHED',
  'OPEN',
  TRUE,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- Conviction angle
INSERT INTO founder.conviction_angles (
  id, founder_id, version_number, statement, domain,
  confidence, derived_from, is_current
) VALUES (
  '01HDEV000000000000000CONVICT',
  '01HDEV000000000000000FOUNDER',
  1,
  'Most marketing advice fails service businesses because it ignores the trust gap completely.',
  'marketing',
  0.850,
  'INTAKE',
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- Memory layers (9 layers, all initialised to baseline)
INSERT INTO memory.memory_layers (founder_id, layer, payload, confidence, data_points)
SELECT
  '01HDEV000000000000000FOUNDER',
  unnest(ARRAY[
    'APPROVAL_INTELLIGENCE','EDIT_PATTERN_INTELLIGENCE',
    'REJECTION_INTELLIGENCE','PERFORMANCE_INTELLIGENCE',
    'BUSINESS_EVOLUTION','SEASONAL_CONTEXTUAL',
    'OFFER_INTELLIGENCE','OUTCOME_INTELLIGENCE','AUDIENCE_TEMPERATURE'
  ]),
  '{}',
  0.0000,
  0
ON CONFLICT (founder_id, layer) DO NOTHING;

-- Founder auth (bcrypt hash of 'devpassword123')
INSERT INTO app.founder_auth (founder_id, password_hash)
VALUES (
  '01HDEV000000000000000FOUNDER',
  '$2b$12$mP8e6h/ig/5OviobYIDtROqO5v9wroLbPMyNAxKghLfdJCQrvzBRa'
) ON CONFLICT (founder_id) DO NOTHING;

-- Founder status projection
INSERT INTO app.founder_status_projection (
  founder_id, status, name, business_name, timezone, activated_at
) VALUES (
  '01HDEV000000000000000FOUNDER',
  'ACTIVE',
  'Dev Founder',
  'Dev Business',
  'Europe/London',
  '2025-01-06T04:00:00Z'
) ON CONFLICT (founder_id) DO NOTHING;

COMMIT;
