-- V067 — Slice 3 "BB gave me a real strategy": Strategy Candidate → Proposal → Current.
--
-- Additive, workspace-schema, business-scoped. Reuses the frozen immutable-versioned-bundle +
-- lifecycle-pointer PATTERN (NOT the diagnosis tables). Each generation is an IMMUTABLE version;
-- role (which version is Current) lives in a separate pointer that moves only on explicit founder
-- adoption. Gate results are stored on the immutable version (append-only within it). Strategy
-- state is structured (core/branch/decisions) — never a single free-text blob; founder prose is a
-- projection of this state.

-- Immutable strategy artifacts. status is the artifact's creation status and never mutates:
--   'proposal'    — passed the M1 Strategy Quality gate stack; safe to present to the founder.
--   'insufficient'— failed the stack after bounded repair (kept as an honest record of the attempt).
-- A version becoming Current is expressed ONLY by the pointer below, not by mutating this row.
CREATE TABLE IF NOT EXISTS workspace.strategy_versions (
  id            TEXT        PRIMARY KEY,
  business_id   TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  version       INTEGER     NOT NULL,                 -- monotonic per business
  status        TEXT        NOT NULL CHECK (status IN ('proposal','insufficient')),
  core          JSONB       NOT NULL,                 -- goal/horizon/diagnosis/coreBet/offer/positioning/audience/constraints/resources/assumptions/tradeOffs/notNow/reconsiderTriggers
  branch        JSONB       NOT NULL,                 -- market/language/messaging/channelPriorities/acquisition/contentRole/cta
  decisions     JSONB       NOT NULL DEFAULT '[]',    -- [{key,title,rationale,sourceRefs[],founderRefs[],claimStrength,assumption,reconsiderTrigger}]
  gate_results  JSONB       NOT NULL DEFAULT '[]',    -- append-only record of gate outcomes for this version
  context_hash  TEXT        NOT NULL,                 -- hash of the generation inputs (understanding + founder state)
  model_id      TEXT        NOT NULL,
  language      TEXT        NOT NULL DEFAULT 'en',     -- founder-facing projection language (canonical state is language-independent)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, version)
);
CREATE INDEX IF NOT EXISTS strategy_versions_biz_idx ON workspace.strategy_versions (business_id, created_at DESC);

-- Lifecycle pointer: which immutable version is the founder-adopted Current strategy. Moves only on
-- explicit adoption; passing gates alone NEVER sets this (no silent adoption). One row per business.
CREATE TABLE IF NOT EXISTS workspace.strategy_pointer (
  business_id        TEXT        PRIMARY KEY REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  current_version_id TEXT        REFERENCES workspace.strategy_versions(id) ON DELETE SET NULL,
  adopted_at         TIMESTAMPTZ,
  adopted_by         TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_strategy_pointer_updated_at ON workspace.strategy_pointer;
CREATE TRIGGER trg_strategy_pointer_updated_at BEFORE UPDATE ON workspace.strategy_pointer
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- RLS defense-in-depth (app-layer membership is authoritative).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['strategy_versions','strategy_pointer'] LOOP
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
