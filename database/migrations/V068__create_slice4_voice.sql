-- V068 — Slice 4 "BB learned my voice": example-grounded Voice Model.
--
-- Additive, workspace-schema, business-scoped. FROZEN invariant: real EXAMPLES + explicit BOUNDARIES
-- + NEGATIVE SPACE are canonical; derived descriptors are secondary. Voice SUBJECTS are separated
-- (founder_public vs brand); founder↔BB conversational voice is NEVER stored as brand output evidence.
-- Voice is scoped by language × market × channel/format × speaking_role with inheritance (store deltas).

-- One profile per (business, subject). subject: founder_public | brand.
CREATE TABLE IF NOT EXISTS workspace.voice_profiles (
  id          TEXT        PRIMARY KEY,
  business_id TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  subject     TEXT        NOT NULL CHECK (subject IN ('founder_public','brand')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, subject)
);

-- Canonical evidence. kind covers founder-written / accepted / rejected / before→after edit halves /
-- claim-boundary illustrations / discovered seeds. edit_group_id links a before/after pair.
CREATE TABLE IF NOT EXISTS workspace.voice_examples (
  id            TEXT        PRIMARY KEY,
  business_id   TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  subject       TEXT        NOT NULL CHECK (subject IN ('founder_public','brand','founder_conversational')),
  kind          TEXT        NOT NULL CHECK (kind IN ('seed','founder_written','accepted','strongly_accepted','rejected','edited_before','edited_after','claim_boundary')),
  text          TEXT        NOT NULL,
  language      TEXT        NOT NULL DEFAULT 'en',
  market        TEXT,
  channel       TEXT,                                   -- reel|carousel|caption|website|email|null
  speaking_role TEXT,                                   -- founder_self|founder_for_brand|brand_institutional|founder_led_brand
  source        TEXT        NOT NULL,                   -- website|founder_public|founder_upload|brand_copy|generated|conversation
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','removed')),
  edit_group_id TEXT,                                   -- links edited_before ↔ edited_after
  provenance    JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS voice_examples_scope_idx ON workspace.voice_examples (business_id, subject, language) WHERE status = 'active';

-- Typed boundaries — kept DISTINCT (voice preference ≠ evidence limit ≠ legal limit ≠ strategic need).
CREATE TABLE IF NOT EXISTS workspace.voice_boundaries (
  id          TEXT        PRIMARY KEY,
  business_id TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  subject     TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('voice','evidence','legal','strategic')),
  statement   TEXT        NOT NULL,
  language    TEXT,                                     -- null = all languages
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Negative space — first-class, actively conditions generation (not just display).
CREATE TABLE IF NOT EXISTS workspace.voice_negative_space (
  id          TEXT        PRIMARY KEY,
  business_id TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  subject     TEXT        NOT NULL,
  category    TEXT        NOT NULL CHECK (category IN ('banned_word','cliche','hook','manipulation','directness','founder_exposure','format','polish','other')),
  value       TEXT        NOT NULL,
  language    TEXT,
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS voice_negspace_idx ON workspace.voice_negative_space (business_id, subject) WHERE status = 'active';

-- Derived patterns — traceable to examples; lifecycle candidate → tentative → established. Never a score.
CREATE TABLE IF NOT EXISTS workspace.voice_patterns (
  id            TEXT        PRIMARY KEY,
  business_id   TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  subject       TEXT        NOT NULL,
  language      TEXT        NOT NULL DEFAULT 'en',
  dimension     TEXT        NOT NULL,                   -- lexical|vocab_preferred|vocab_avoided|rhythm|directness|hook|claim_style|emotional_register|structure|cta|format
  statement     TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','tentative','established','superseded')),
  observations  INTEGER     NOT NULL DEFAULT 1,          -- count of same-direction observations (NOT a confidence score)
  example_refs  JSONB       NOT NULL DEFAULT '[]',
  supersedes    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS voice_patterns_idx ON workspace.voice_patterns (business_id, subject, language) WHERE status <> 'superseded';

-- Generated calibration samples (text/structured only — NOT rendered assets).
CREATE TABLE IF NOT EXISTS workspace.voice_samples (
  id            TEXT        PRIMARY KEY,
  business_id   TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  session_id    TEXT,
  subject       TEXT        NOT NULL,
  language      TEXT        NOT NULL DEFAULT 'en',
  market        TEXT,
  channel       TEXT        NOT NULL,                   -- reel|carousel|caption
  speaking_role TEXT        NOT NULL,
  objective     TEXT        NOT NULL,                   -- strategy-derived content objective
  content       JSONB       NOT NULL,                   -- {hook,beats[],cta} | {caption} etc.
  -- Immutable safety provenance captured at generation time (never recomputed from mutable current state).
  authorization_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, -- source-typed licensed props + stance provenance + CTA + judge model/contract/prompt hashes
  safety_decision        JSONB NOT NULL DEFAULT '{}'::jsonb, -- deterministic Layer-1/2 + N=3 judge passes/union + repair + final disposition
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reacted','superseded')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS voice_samples_idx ON workspace.voice_samples (business_id, session_id, created_at DESC);

-- Feedback events. target separates strategy critique from voice critique. signal orders evidence strength.
CREATE TABLE IF NOT EXISTS workspace.voice_feedback (
  id            TEXT        PRIMARY KEY,
  business_id   TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  session_id    TEXT,
  sample_id     TEXT,
  target        TEXT        NOT NULL CHECK (target IN ('idea','wording','both','unclear')),
  signal        TEXT        NOT NULL CHECK (signal IN ('strongly_accept','accept_weak','reject','edit','founder_written')),
  reaction_text TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per (business, subject, language, market) calibration session.
CREATE TABLE IF NOT EXISTS workspace.voice_calibration_sessions (
  id          TEXT        PRIMARY KEY,
  business_id TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  subject     TEXT        NOT NULL,
  language    TEXT        NOT NULL DEFAULT 'en',
  market      TEXT,
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','sufficient','paused')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, subject, language, market)
);

-- Stable resolved-voice version identity (so later Assets can reference which voice produced them).
CREATE TABLE IF NOT EXISTS workspace.voice_versions (
  id           TEXT        PRIMARY KEY,
  business_id  TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  subject      TEXT        NOT NULL,
  language     TEXT        NOT NULL,
  market       TEXT,
  version      INTEGER     NOT NULL,
  content_hash TEXT        NOT NULL,
  resolved     JSONB       NOT NULL,                    -- snapshot of the working set at this revision
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, subject, language, market, version)
);

DROP TRIGGER IF EXISTS trg_voice_sessions_updated_at ON workspace.voice_calibration_sessions;
CREATE TRIGGER trg_voice_sessions_updated_at BEFORE UPDATE ON workspace.voice_calibration_sessions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS trg_voice_patterns_updated_at ON workspace.voice_patterns;
CREATE TRIGGER trg_voice_patterns_updated_at BEFORE UPDATE ON workspace.voice_patterns
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- RLS defense-in-depth (app-layer membership is authoritative).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['voice_profiles','voice_examples','voice_boundaries','voice_negative_space','voice_patterns','voice_samples','voice_feedback','voice_calibration_sessions','voice_versions'] LOOP
    EXECUTE format('ALTER TABLE workspace.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_member ON workspace.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_member ON workspace.%I USING (business_id IN (SELECT m.business_id FROM workspace.memberships m WHERE m.founder_id = current_setting(''app.current_founder_id'', TRUE)))',
      t, t);
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bbapp') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA workspace TO bbapp;
  END IF;
END;
$$;
