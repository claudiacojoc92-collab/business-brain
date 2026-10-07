-- V062: Business Brain provenance store (Phase ②).
--
-- The MINIMUM persisted dataset that lets every future conclusion be traced back to the imported
-- Instagram observations. Version-scoped and immutable; each row cascades when its Candidate Version
-- is discarded and when the Founder is deleted (both via the bb_version → founder.founders cascade,
-- exactly like the V060 children).
--
-- CONTAINMENT: OAuth tokens are NEVER stored here — they live only in app.oauth_credentials. What is
-- stored is the founder's own public content (captions, post metrics) plus deterministic signals and
-- the exact model input. Captions are retention-bound to the Version and are covered by the founder
-- export and account-deletion paths.
--
-- HONESTY: no per-post theme/classification is stored (theme is the single LLM call's holistic reading,
-- not a deterministic fact). Only DETERMINISTIC signals live on bb_observation. A metric that Instagram
-- did not return (e.g. reach on an old post) is NULL here, never fabricated.

-- ── One import run per Version: account snapshot + the imported window ────────────────────────────
CREATE TABLE IF NOT EXISTS businessbrain.bb_import (
  import_id           TEXT        NOT NULL PRIMARY KEY,   -- ULID (internal)
  version_id          TEXT        NOT NULL UNIQUE
    REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id          TEXT        NOT NULL,               -- denormalised (no FK; matches V060 children)
  source              TEXT        NOT NULL DEFAULT 'instagram',
  account_external_id TEXT,                               -- IG user id (not secret)
  account_username    TEXT,
  account_type        TEXT,
  followers_count     INTEGER,
  media_count         INTEGER,                            -- account total (context)
  imported_post_count INTEGER     NOT NULL,               -- how many posts this import actually captured
  window_from         TIMESTAMPTZ,                        -- oldest imported post
  window_to           TIMESTAMPTZ,                        -- newest imported post
  imported_at         TIMESTAMPTZ NOT NULL,
  UNIQUE (import_id, version_id),                         -- lets children pin (import_id, version_id)
  CONSTRAINT bb_import_source_valid CHECK (source IN ('instagram'))
);
CREATE INDEX IF NOT EXISTS bb_import_founder_idx ON businessbrain.bb_import (founder_id);

-- ── One row per imported post: identity + REAL metrics + FULL caption + DETERMINISTIC signals ─────
CREATE TABLE IF NOT EXISTS businessbrain.bb_observation (
  observation_id   TEXT        NOT NULL PRIMARY KEY,      -- ULID (internal)
  import_id        TEXT        NOT NULL
    REFERENCES businessbrain.bb_import(import_id) ON DELETE CASCADE,
  version_id       TEXT        NOT NULL
    REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id       TEXT        NOT NULL,
  post_external_id TEXT        NOT NULL,                  -- IG media id
  permalink        TEXT,                                  -- public URL — the human-checkable handle
  media_type       TEXT,                                  -- IMAGE | VIDEO | CAROUSEL_ALBUM | ...
  posted_at        TIMESTAMPTZ,
  reach            INTEGER,                               -- NULL when Instagram did not return it (never faked)
  likes            INTEGER,
  comments         INTEGER,
  caption          TEXT        NOT NULL DEFAULT '',       -- FULL caption (retention-bound provenance)
  -- deterministic signals (computed by code, never by the model):
  caption_length   INTEGER     NOT NULL DEFAULT 0,
  word_count       INTEGER     NOT NULL DEFAULT 0,
  hashtag_count    INTEGER     NOT NULL DEFAULT 0,
  mention_count    INTEGER     NOT NULL DEFAULT 0,
  has_link         BOOLEAN     NOT NULL DEFAULT FALSE,
  has_cta          BOOLEAN     NOT NULL DEFAULT FALSE,
  UNIQUE (observation_id, version_id),
  UNIQUE (version_id, post_external_id)                   -- one observation per post per import
);
CREATE INDEX IF NOT EXISTS bb_observation_version_idx ON businessbrain.bb_observation (version_id);
CREATE INDEX IF NOT EXISTS bb_observation_import_idx  ON businessbrain.bb_observation (import_id);

-- ── The EXACT structured context handed to the single LLM call — frozen + hashed for reproducibility ─
CREATE TABLE IF NOT EXISTS businessbrain.bb_generation_context (
  generation_context_id TEXT      NOT NULL PRIMARY KEY,   -- ULID (internal)
  version_id           TEXT       NOT NULL UNIQUE
    REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id           TEXT        NOT NULL,
  context              JSONB       NOT NULL,               -- the deterministic input the model saw
  content_hash         TEXT        NOT NULL,               -- SHA-256 over canonical(context)
  model_id             TEXT,
  prompt_template_hash TEXT,
  created_at           TIMESTAMPTZ NOT NULL,
  UNIQUE (generation_context_id, version_id)
);

-- ── Provenance link on each evidence measure: how it was derived + which observations back it ─────
-- {"source":"deterministic","metricKey":"...","observationRefs":["<permalink|post_external_id>", ...]}
ALTER TABLE businessbrain.bb_evidence_item
  ADD COLUMN IF NOT EXISTS provenance JSONB;

-- Phase ② adds a deterministic 'count' measure (totals/averages/cadence) alongside proportion/presence/absence.
ALTER TABLE businessbrain.bb_evidence_item DROP CONSTRAINT IF EXISTS bb_ei_kind_valid;
ALTER TABLE businessbrain.bb_evidence_item
  ADD CONSTRAINT bb_ei_kind_valid CHECK (kind IN ('proportion', 'count', 'presence', 'absence'));
