-- Slice 7 (Vertical 2) — "Tell me what to film". Additive; no existing table is modified and V077 is untouched.
-- Immutable, versioned upstream shoot-planning lineage that converges into the frozen V1 reel asset. All rows are
-- business-scoped. ShotRequests are embedded in the plan-version payload (jsonb), matching the V077 payload shape.

CREATE TABLE IF NOT EXISTS workspace.reel_concept (
  reel_concept_id  text PRIMARY KEY,
  business_id      text NOT NULL,
  strategy_version_id text NOT NULL,
  payload          jsonb NOT NULL,
  content_hash     text NOT NULL,
  produced_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_concept_biz_idx ON workspace.reel_concept (business_id);

CREATE TABLE IF NOT EXISTS workspace.reel_shooting_plan_version (
  version_id         text PRIMARY KEY,
  shooting_plan_id   text NOT NULL,
  reel_concept_id    text NOT NULL,
  business_id        text NOT NULL,
  version_number     integer NOT NULL,
  supersedes_version_id text,
  payload            jsonb NOT NULL,   -- includes ordered shotRequests + guidance + constraintsApplied
  content_hash       text NOT NULL,
  produced_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_plan_biz_idx ON workspace.reel_shooting_plan_version (business_id, shooting_plan_id);

CREATE TABLE IF NOT EXISTS workspace.reel_shot_fulfillment (
  shooting_plan_version_id text PRIMARY KEY,   -- one immutable report per plan-version (latest match wins by upsert)
  business_id              text NOT NULL,
  video_set_understanding_id text NOT NULL,
  sufficiency              text NOT NULL,
  payload                  jsonb NOT NULL,      -- fulfillments[] + smallestMissing
  produced_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_fulfillment_biz_idx ON workspace.reel_shot_fulfillment (business_id);

CREATE TABLE IF NOT EXISTS workspace.reel_shoot_context (
  reel_shoot_context_id text PRIMARY KEY,
  business_id           text NOT NULL,
  reel_concept_id       text NOT NULL,
  shooting_plan_version_id text NOT NULL,
  video_set_understanding_id text NOT NULL,
  opportunity_id        text NOT NULL,   -- frozen V1 opportunity produced from the seed
  asset_id              text NOT NULL,   -- frozen V1 asset (lineage link; frozen tables untouched)
  payload               jsonb NOT NULL,  -- fulfillments + substitutions + conceptSeed
  produced_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reel_shoot_ctx_asset_idx ON workspace.reel_shoot_context (business_id, asset_id);
