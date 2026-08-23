-- V076: Slice 6.1 — Photo-Led Carousel Creation. UNSHIPPED (feature/business-brain-v1).
-- A SECOND create entry path that converges on the FROZEN Slice-6 carousel engine. These records are MEDIA +
-- PROVENANCE only — they carry NO claims/copy/authorized propositions (claim authority stays in the frozen
-- AssetAuthorizationSnapshot). PhotoSetUnderstanding = literal observed media facts; CarouselOpportunity = the
-- one strategy-specific recommendation + sufficiency; PhotoLedCarouselContext = the immutable, hashed media plan
-- bound 1:1 to a normal CreateHandoff (the additive seam the frozen carousel service resolves).

CREATE TABLE IF NOT EXISTS workspace.photo_set_understanding (
  photo_set_understanding_id TEXT        PRIMARY KEY,
  business_id                TEXT        NOT NULL,
  observations               JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- MediaObservation[] (stable observationId each)
  set_signal                 TEXT        NOT NULL,
  model_id                   TEXT,
  content_hash               TEXT        NOT NULL,
  produced_at                TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_set_understanding_biz_idx ON workspace.photo_set_understanding (business_id, produced_at DESC);

CREATE TABLE IF NOT EXISTS workspace.carousel_opportunity (
  opportunity_id             TEXT        PRIMARY KEY,
  business_id                TEXT        NOT NULL,
  photo_set_understanding_id TEXT        NOT NULL,
  origin                     TEXT        NOT NULL,
  strategy_version_id        TEXT        NOT NULL,
  sufficiency                TEXT        NOT NULL,
  payload                    JSONB       NOT NULL,  -- the full CarouselOpportunity (recommendation + media subset)
  produced_at                TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS carousel_opportunity_biz_idx ON workspace.carousel_opportunity (business_id, produced_at DESC);

CREATE TABLE IF NOT EXISTS workspace.photo_led_carousel_context (
  photo_led_context_id       TEXT        PRIMARY KEY,
  business_id                TEXT        NOT NULL,
  create_handoff_id          TEXT        NOT NULL UNIQUE,   -- 1:1 binding to a normal CreateHandoff
  opportunity_id             TEXT        NOT NULL,
  photo_set_understanding_id TEXT        NOT NULL,
  origin                     TEXT        NOT NULL,
  strategy_trace             JSONB       NOT NULL,
  selected_media             JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- {sourceRefId, role, observationRefs[]}[]
  excluded_media             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  content_hash               TEXT        NOT NULL,
  produced_at                TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_led_context_biz_idx ON workspace.photo_led_carousel_context (business_id, create_handoff_id);
