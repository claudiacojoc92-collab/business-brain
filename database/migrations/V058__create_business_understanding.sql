-- V058: Business Understanding (A–E Wave 2). Versioned, append-only synthesis of a founder's business from
-- observed evidence + the frozen engine's output. A founder correction creates a NEW version (supersedes_id
-- links the lineage); the original is preserved for auditability. Latest = highest version per founder.
-- Conclusions + source references are versioned JSONB (deliberately not over-normalized while the AI shape
-- is still stabilizing). No FK cascade by design; deletion coverage is explicit in delete.service.

CREATE SCHEMA IF NOT EXISTS business;

CREATE TABLE IF NOT EXISTS business.understanding (
  id                   TEXT        PRIMARY KEY,                 -- ULID
  founder_id           TEXT        NOT NULL,
  version              INT         NOT NULL,                    -- 1,2,3… per founder (correction → +1)
  supersedes_id        TEXT,                                    -- the version this revises (null for v1)
  model_version        TEXT        NOT NULL,                    -- synthesis prompt/model identifier or checksum
  source_fragment_ids  JSONB       NOT NULL DEFAULT '[]'::jsonb, -- observed evidence the synthesis drew on
  conclusions          JSONB       NOT NULL DEFAULT '[]'::jsonb, -- Conclusion[] (id/type/statement/epistemicStatus/…)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (founder_id, version)
);

CREATE INDEX IF NOT EXISTS idx_understanding_founder_version ON business.understanding (founder_id, version DESC);

COMMENT ON TABLE business.understanding IS
  'Wave 2 versioned business understanding: founder-legible, epistemically-banded conclusions synthesized over the frozen engine. Append-only; corrections create a new version (supersedes_id lineage).';
