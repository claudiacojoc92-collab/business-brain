-- Slice 7 (Vertical 1) — Reel Creation. Additive; no existing table is modified. Immutable content + lineage +
-- append-only revision/safety trace, mirroring the carousel/photo-led shape. All rows are business-scoped.

CREATE TABLE IF NOT EXISTS workspace.reel_source (
  source_ref_id   text PRIMARY KEY,
  business_id     text NOT NULL,
  upload_set_id   text NOT NULL,
  object_key      text NOT NULL,
  reuse_right     text NOT NULL,
  filename        text,
  bytes           bigint,
  sha256          text,
  container       text,
  audio_rights    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_source_set_idx ON workspace.reel_source (business_id, upload_set_id);

CREATE TABLE IF NOT EXISTS workspace.reel_video_understanding (
  video_set_understanding_id text PRIMARY KEY,
  business_id  text NOT NULL,
  payload      jsonb NOT NULL,
  content_hash text NOT NULL,
  produced_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_vsu_biz_idx ON workspace.reel_video_understanding (business_id);

CREATE TABLE IF NOT EXISTS workspace.reel_transcript (
  transcript_id text PRIMARY KEY,
  source_ref_id text NOT NULL,
  payload       jsonb NOT NULL,
  produced_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace.reel_opportunity (
  opportunity_id text PRIMARY KEY,
  business_id    text NOT NULL,
  payload        jsonb NOT NULL,
  produced_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_opportunity_biz_idx ON workspace.reel_opportunity (business_id);

CREATE TABLE IF NOT EXISTS workspace.reel_authorization_snapshot (
  snapshot_id text PRIMARY KEY,
  business_id text NOT NULL,
  payload     jsonb NOT NULL,
  produced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace.reel_asset (
  asset_id           text PRIMARY KEY,
  business_id        text NOT NULL,
  create_handoff_id  text,
  strategy_version_id text NOT NULL,
  current_version_id text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_asset_biz_idx ON workspace.reel_asset (business_id);

CREATE TABLE IF NOT EXISTS workspace.reel_asset_version (
  version_id     text PRIMARY KEY,
  asset_id       text NOT NULL,
  business_id    text NOT NULL,
  version_number integer NOT NULL,
  edl_hash       text NOT NULL,
  content_hash   text NOT NULL,
  payload        jsonb NOT NULL,
  produced_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_version_asset_idx ON workspace.reel_asset_version (asset_id);

CREATE TABLE IF NOT EXISTS workspace.reel_render (
  render_id       text PRIMARY KEY,
  version_id      text NOT NULL,
  renderer_version text NOT NULL,
  ffmpeg_build    text NOT NULL,
  edl_hash        text NOT NULL,
  mp4_key         text NOT NULL,
  poster_key      text NOT NULL,
  width_px        integer NOT NULL,
  height_px       integer NOT NULL,
  duration_ms     integer NOT NULL,
  gate_valid      boolean NOT NULL,
  payload         jsonb NOT NULL,
  produced_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reel_render_version_idx ON workspace.reel_render (version_id);

CREATE TABLE IF NOT EXISTS workspace.reel_revision_event (
  id             text PRIMARY KEY,
  asset_id       text NOT NULL,
  from_version_id text NOT NULL,
  to_version_id  text NOT NULL,
  scope          text NOT NULL,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_revision_asset_idx ON workspace.reel_revision_event (asset_id);

CREATE TABLE IF NOT EXISTS workspace.reel_safety_trace (
  trace_id     text PRIMARY KEY,
  business_id  text NOT NULL,
  asset_id     text NOT NULL,
  version_id   text,
  disposition  text NOT NULL,
  payload      jsonb NOT NULL,
  produced_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_safety_asset_idx ON workspace.reel_safety_trace (asset_id);

CREATE TABLE IF NOT EXISTS workspace.reel_job (
  job_id      text PRIMARY KEY,
  business_id text NOT NULL,
  upload_set_id text NOT NULL,
  stage       text NOT NULL,
  payload     jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_job_biz_idx ON workspace.reel_job (business_id);
