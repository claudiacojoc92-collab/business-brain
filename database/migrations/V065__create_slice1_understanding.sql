-- V065 — Slice 1 "BB learned my business": website source binding + governed understanding + Aha 1.
--
-- Additive. The immutable evidence.fragments store (V050) is NOT changed or re-keyed.
-- A first-class business↔evidence binding attaches immutable fragments to a Business without
-- copying or mutating them. Governed understanding + Aha are SYNTHESIS artifacts (inference over
-- the observed fragments), stored separately from the observed evidence — inference is never
-- written back as observation.

-- Website + ingestion state on the business (founder-facing "learning" surface reads these).
ALTER TABLE workspace.businesses ADD COLUMN IF NOT EXISTS website_url     TEXT;
ALTER TABLE workspace.businesses ADD COLUMN IF NOT EXISTS ingestion_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE workspace.businesses ADD COLUMN IF NOT EXISTS ingested_at     TIMESTAMPTZ;

-- Provenance boundary: (business) → (immutable evidence fragment). No copy, no re-key.
CREATE TABLE IF NOT EXISTS workspace.business_evidence_links (
  id                  TEXT        PRIMARY KEY,
  business_id         TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  evidence_fragment_id TEXT       NOT NULL REFERENCES evidence.fragments(id) ON DELETE CASCADE,
  source              TEXT        NOT NULL,          -- e.g. 'website'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, evidence_fragment_id)         -- idempotent binding
);
CREATE INDEX IF NOT EXISTS bel_business_idx ON workspace.business_evidence_links (business_id);

-- Discovered public profiles (from the website) — DISCOVERED, not ingested. Ownership only.
CREATE TABLE IF NOT EXISTS workspace.discovered_profiles (
  id                  TEXT        PRIMARY KEY,
  business_id         TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  platform            TEXT        NOT NULL,          -- instagram|facebook|linkedin|youtube|tiktok|google_business|other
  url                 TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','confirmed','rejected')),
  discovered_from_url TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, url)
);
CREATE INDEX IF NOT EXISTS dp_business_idx ON workspace.discovered_profiles (business_id);

-- Immutable governed-understanding snapshot (synthesis over linked observed fragments).
CREATE TABLE IF NOT EXISTS workspace.understanding_snapshots (
  id               TEXT        PRIMARY KEY,
  business_id      TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  profile_version  TEXT        NOT NULL,             -- e.g. 'website.offer_positioning_audience.v1'
  content_hash     TEXT        NOT NULL,             -- SHA-256 of the frozen synthesis input
  source_ref_count INTEGER     NOT NULL DEFAULT 0,
  source_language  TEXT,                             -- detected source language (metadata; state stays language-general)
  understanding    JSONB       NOT NULL,             -- {offer,positioning,audience,messaging,acquisition,contradictions,unknowns}
  model_id         TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS us_business_idx ON workspace.understanding_snapshots (business_id, created_at DESC);

-- Immutable Aha version (founder-facing findings). Never overwritten; a new version is appended.
CREATE TABLE IF NOT EXISTS workspace.aha_versions (
  id                       TEXT        PRIMARY KEY,
  business_id              TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  understanding_snapshot_id TEXT       NOT NULL REFERENCES workspace.understanding_snapshots(id) ON DELETE CASCADE,
  language                 TEXT        NOT NULL,     -- founder-facing projection language
  content_hash            TEXT        NOT NULL,
  model_id                TEXT        NOT NULL,
  findings                JSONB       NOT NULL,      -- [{finding, implication?, sourceRefs:[{label,url}]}]
  status                  TEXT        NOT NULL DEFAULT 'produced' CHECK (status IN ('produced','insufficient')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS aha_business_idx ON workspace.aha_versions (business_id, created_at DESC);

-- RLS defense-in-depth (app-layer membership is authoritative; dev owner role bypasses RLS).
ALTER TABLE workspace.business_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace.discovered_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace.understanding_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace.aha_versions             ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_evidence_links','discovered_profiles','understanding_snapshots','aha_versions'] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I_member ON workspace.%I', t, t);
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
