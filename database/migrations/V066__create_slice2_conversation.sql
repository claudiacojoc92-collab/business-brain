-- V066 — Slice 2 "BB understood me": founder conversation + founder-owned/observed model + Aha 2.
--
-- Additive, workspace-schema, business-scoped. Founder-OWNED state (goal/horizon/constraint/
-- preference/decision/intention/challenge_permission/resource/business_correction) is kept
-- structurally separate from OBSERVED patterns (candidate→supported→confirmed, evidence-backed,
-- correctable/deletable). Conversation turns are append-only with a per-session ordering seq.

-- One founder↔BB conversation per business (resumable).
CREATE TABLE IF NOT EXISTS workspace.conversation_sessions (
  id                    TEXT        PRIMARY KEY,
  business_id           TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  founder_id            TEXT        NOT NULL REFERENCES founder.founders(id) ON DELETE CASCADE,
  conversation_language TEXT        NOT NULL DEFAULT 'en',
  status                TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ready_for_aha2')),
  current_focus         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id)
);

-- Append-only ordered turns. `seq` is the ordering authority (monotonic per session).
CREATE TABLE IF NOT EXISTS workspace.conversation_turns (
  id            TEXT        PRIMARY KEY,
  session_id    TEXT        NOT NULL REFERENCES workspace.conversation_sessions(id) ON DELETE CASCADE,
  business_id   TEXT        NOT NULL,
  seq           INTEGER     NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('founder','bb')),
  content       TEXT        NOT NULL,
  language      TEXT        NOT NULL DEFAULT 'en',
  info_need_key TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, seq)
);

-- Internal (never founder-facing): what BB still needs and why it is decision-relevant.
CREATE TABLE IF NOT EXISTS workspace.information_needs (
  id           TEXT        PRIMARY KEY,
  session_id   TEXT        NOT NULL REFERENCES workspace.conversation_sessions(id) ON DELETE CASCADE,
  business_id  TEXT        NOT NULL,
  key          TEXT        NOT NULL,
  what_missing TEXT        NOT NULL,
  why_matters  TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','no_longer_needed','deferred')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, key)
);

-- Founder-OWNED state (authoritative for what the founder wants/chose/constrains). Append + supersede.
CREATE TABLE IF NOT EXISTS workspace.founder_state (
  id            TEXT        PRIMARY KEY,
  business_id   TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  founder_id    TEXT        NOT NULL,
  kind          TEXT        NOT NULL CHECK (kind IN
                  ('goal','horizon','constraint','preference','decision','intention',
                   'challenge_permission','resource','business_correction')),
  statement     TEXT        NOT NULL,
  scope         TEXT,                              -- e.g. challenge-permission scope, resource type
  temporary     BOOLEAN     NOT NULL DEFAULT FALSE,
  supersedes    TEXT,                              -- prior founder_state.id this replaces
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','deleted')),
  language      TEXT        NOT NULL DEFAULT 'en', -- language of the founder's own words (state is language-independent)
  source_turn_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS founder_state_biz_idx ON workspace.founder_state (business_id, kind) WHERE status = 'active';

-- OBSERVED founder patterns (NOT authoritative). Evidence-backed, lifecycle, correctable/deletable.
CREATE TABLE IF NOT EXISTS workspace.founder_observations (
  id           TEXT        PRIMARY KEY,
  business_id  TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  behavior     TEXT        NOT NULL,               -- observable decision/communication behavior (no psychology)
  turn_refs    JSONB       NOT NULL DEFAULT '[]',  -- concrete conversation turn ids supporting it
  status       TEXT        NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','supported','confirmed','rejected','deleted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS founder_obs_biz_idx ON workspace.founder_observations (business_id);

-- Immutable Aha 2 (cross-source synthesis). Cites business + founder state; never overwritten.
CREATE TABLE IF NOT EXISTS workspace.aha2_versions (
  id                        TEXT        PRIMARY KEY,
  business_id               TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  session_id                TEXT        REFERENCES workspace.conversation_sessions(id) ON DELETE SET NULL,
  understanding_snapshot_id TEXT,
  language                  TEXT        NOT NULL,
  content_hash             TEXT        NOT NULL,
  model_id                 TEXT        NOT NULL,
  findings                 JSONB       NOT NULL,   -- [{implication, businessRefs[], founderRefs[], observationRefs[]}]
  status                   TEXT        NOT NULL DEFAULT 'produced' CHECK (status IN ('produced','insufficient')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS aha2_biz_idx ON workspace.aha2_versions (business_id, created_at DESC);

-- keep updated_at fresh
DROP TRIGGER IF EXISTS trg_set_updated_at ON workspace.conversation_sessions;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON workspace.conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- RLS defense-in-depth (app-layer membership is authoritative).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversation_sessions','conversation_turns','information_needs','founder_state','founder_observations','aha2_versions'] LOOP
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
