-- ================================================================
-- V048 — Add B1 Onboarding Signal Types to bb_types.signal_type
-- ================================================================
-- Purpose: Extend the signal_type enum with the 28 intake-interview
--   signal types introduced by Phase 9A.5 (Founder Intelligence / B1).
--   Each new value corresponds to one of the 28 Core Interview questions
--   in the conversational onboarding flow.
--
-- Safety: ALTER TYPE … ADD VALUE is non-breaking in PostgreSQL 12+.
--   No rows are modified. No existing enum values are changed.
--   Flyway runs each migration inside its own transaction; in PG12+
--   ADD VALUE is permitted in a transaction provided the new value is
--   not USED in the same transaction (it is not here). No explicit
--   BEGIN/COMMIT — that would conflict with Flyway's transaction.
--
-- Run after: V047__add_documentation_comments.sql
-- ================================================================

-- Block 1 — Conviction
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'CONVICTION_MECHANISM';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'FOUNDING_STORY';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'BELIEF_TARGET';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'CONVICTION_FALSIFICATION';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'EDUCATION_INSIGHT';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'CONTRARIAN_POSITION';

-- Block 2 — Voice
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'VOICE_OPENING_EXAMPLE';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'VOICE_REJECTION_EXAMPLE';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'VOICE_SYNONYM';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'VOICE_CTA_EXAMPLE';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'VOICE_ANALOGY';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'CONTENT_HARD_BLOCK';

-- Block 3 — Audience
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'AUDIENCE_INTERNAL_MONOLOGUE';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'AUDIENCE_SOCIAL_FRAMING';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'AUDIENCE_SELF_PROTECTION';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'WARM_SIGNAL_VOCABULARY';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'COLD_SIGNAL_VOCABULARY';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'AUDIENCE_FALSE_ASSUMPTION';

-- Block 4 — Offer
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'OFFER_NATURAL_LANGUAGE';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'OFFER_PRICE_PHILOSOPHY';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'PRIMARY_OBJECTION';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'OBJECTION_RESPONSE';

-- Block 5 — Approval standard
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'APPROVAL_STANDARD_POSITIVE';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'APPROVAL_STANDARD_NEGATIVE';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'ZERO_EDIT_CRITERIA';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'INTENDED_AUDIENCE_MOVEMENT';

-- Block 6 — Direct feedback
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'UNSOLICITED_HIGH_VALUE';
ALTER TYPE bb_types.signal_type ADD VALUE IF NOT EXISTS 'TRUST_CRITERIA';
