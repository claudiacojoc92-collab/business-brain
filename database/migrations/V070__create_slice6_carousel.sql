-- V070: Slice 6 — Carousel Asset Creation. UNSHIPPED (feature/business-brain-v1).
-- Immutable asset content + authorization snapshot + render (INSERT-ONLY); only the asset's
-- current_version_id pointer moves; revisions are append-only. Binary slide PNGs/ZIP live in the blob store,
-- NOT in Postgres — this holds metadata + blob keys only.

CREATE TABLE IF NOT EXISTS workspace.carousel_asset (
  asset_id            TEXT        PRIMARY KEY,
  business_id         TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  create_handoff_id   TEXT        NOT NULL,
  plan_version_id     TEXT        NOT NULL,
  strategy_version_id TEXT        NOT NULL,
  current_version_id  TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS carousel_asset_biz_idx ON workspace.carousel_asset (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS carousel_asset_handoff_idx ON workspace.carousel_asset (business_id, create_handoff_id);

-- Immutable versioned asset content (slides/concept/brief/visual system + content_hash).
CREATE TABLE IF NOT EXISTS workspace.carousel_asset_version (
  version_id               TEXT        PRIMARY KEY,
  asset_id                 TEXT        NOT NULL,
  version_number           INTEGER     NOT NULL,
  business_id              TEXT        NOT NULL,
  brief                    JSONB       NOT NULL,
  concept                  JSONB       NOT NULL,
  slides                   JSONB       NOT NULL,
  visual_system            JSONB       NOT NULL,
  brand_context_version    TEXT        NOT NULL,
  language_context         TEXT        NOT NULL,
  authorization_snapshot_id TEXT       NOT NULL,
  source_manifest          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  content_hash             TEXT        NOT NULL,
  produced_at              TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS carousel_version_asset_idx ON workspace.carousel_asset_version (asset_id, version_number);

-- Immutable authorization snapshot for the asset-generation decision (reuses frozen typed semantics).
CREATE TABLE IF NOT EXISTS workspace.carousel_authorization_snapshot (
  snapshot_id           TEXT        PRIMARY KEY,
  business_id           TEXT        NOT NULL,
  create_handoff_id     TEXT        NOT NULL,
  strategy_version_id   TEXT        NOT NULL,
  language              TEXT        NOT NULL,
  speaking_role         TEXT        NOT NULL,
  audience_use_context  TEXT        NOT NULL,
  licensed_propositions JSONB       NOT NULL,
  proof_facts           JSONB       NOT NULL,
  cta_function          TEXT        NOT NULL,
  owned_stances         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  source_refs           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  model_id              TEXT,
  safety_contract_hash  TEXT,
  produced_at           TIMESTAMPTZ NOT NULL
);

-- Immutable render (per-slide blob keys + gate report). A new render row per (re)render.
CREATE TABLE IF NOT EXISTS workspace.carousel_render (
  render_id        TEXT        PRIMARY KEY,
  version_id       TEXT        NOT NULL,
  renderer_version TEXT        NOT NULL,
  canvas_spec      JSONB       NOT NULL,
  slide_images     JSONB       NOT NULL,
  export_zip_key   TEXT,
  gate_report      JSONB       NOT NULL,
  produced_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS carousel_render_version_idx ON workspace.carousel_render (version_id, produced_at DESC);

-- Append-only revision events (scoped, non-destructive; new version per material revision).
CREATE TABLE IF NOT EXISTS workspace.carousel_revision_event (
  id              TEXT        PRIMARY KEY,
  asset_id        TEXT        NOT NULL,
  from_version_id TEXT        NOT NULL,
  to_version_id   TEXT        NOT NULL,
  scope           JSONB       NOT NULL,
  at              TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS carousel_revision_asset_idx ON workspace.carousel_revision_event (asset_id, at ASC);
