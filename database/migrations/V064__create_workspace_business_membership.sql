-- V064 — Slice 0 tenancy seam: Business + Membership.
--
-- Additive and incremental (per M1 Slice-0 decision 1): the legacy founder_id-scoped
-- tables are NOT migrated. `founder.founders` remains the person/user identity. A new
-- `workspace` schema introduces the Business entity and the User×Business membership
-- that authorizes access. New M1 business-owned content tables (Slice 1+) will be
-- business_id-scoped; Slice 0 only needs the seam and the person↔business link.
--
-- Application-layer membership authorization is authoritative. RLS here is
-- defense-in-depth (in dev the owner DB role bypasses RLS; in prod the app role does not).

CREATE SCHEMA IF NOT EXISTS workspace;

-- Person-level preferences (Slice 0). interface_locale drives UI language (ro/en/it).
-- business_name becomes optional: business identity now lives in workspace.businesses,
-- and account registration no longer collects a business name up front.
ALTER TABLE founder.founders ADD COLUMN IF NOT EXISTS interface_locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE founder.founders ALTER COLUMN business_name DROP NOT NULL;

-- A Business (workspace). Owned by a founder (person). One founder may own many.
CREATE TABLE IF NOT EXISTS workspace.businesses (
  id                            TEXT        PRIMARY KEY,
  owner_founder_id              TEXT        NOT NULL REFERENCES founder.founders(id) ON DELETE CASCADE,
  name                          TEXT        NOT NULL,
  -- Persisted home for the conversation-language preference (Conversation lands in Slice 2).
  default_conversation_language TEXT        NOT NULL DEFAULT 'en',
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS businesses_owner_idx
  ON workspace.businesses (owner_founder_id)
  WHERE deleted_at IS NULL;

-- Membership authorizes a founder to access a business. Owner role only in M1.
CREATE TABLE IF NOT EXISTS workspace.memberships (
  id           TEXT        PRIMARY KEY,
  business_id  TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  founder_id   TEXT        NOT NULL REFERENCES founder.founders(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, founder_id)
);

CREATE INDEX IF NOT EXISTS memberships_founder_idx
  ON workspace.memberships (founder_id);

-- keep updated_at fresh (reuses app.set_updated_at from V033)
DROP TRIGGER IF EXISTS trg_set_updated_at ON workspace.businesses;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON workspace.businesses
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- RLS defense-in-depth (authoritative check is app-layer membership).
ALTER TABLE workspace.businesses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace.memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS businesses_member_isolation ON workspace.businesses;
CREATE POLICY businesses_member_isolation ON workspace.businesses
  USING (
    id IN (
      SELECT m.business_id FROM workspace.memberships m
      WHERE m.founder_id = current_setting('app.current_founder_id', TRUE)
    )
  );

DROP POLICY IF EXISTS memberships_self_isolation ON workspace.memberships;
CREATE POLICY memberships_self_isolation ON workspace.memberships
  USING (founder_id = current_setting('app.current_founder_id', TRUE));

-- Grant to the application role when present (mirrors V037; dev bbuser is superuser).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bbapp') THEN
    GRANT USAGE ON SCHEMA workspace TO bbapp;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA workspace TO bbapp;
  END IF;
END;
$$;
