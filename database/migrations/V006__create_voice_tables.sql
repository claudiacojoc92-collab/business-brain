CREATE TABLE IF NOT EXISTS founder.voice_versions (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL REFERENCES founder.founders(id),
  version_number        INTEGER     NOT NULL,
  derived_from          TEXT        NOT NULL,
  sentence_rhythm       TEXT        NOT NULL,
  opening_pattern       TEXT        NOT NULL,
  closing_pattern       TEXT        NOT NULL,
  conviction_posture    TEXT        NOT NULL,
  vulnerability_level   TEXT        NOT NULL,
  specificity_level     TEXT        NOT NULL,
  cta_style             TEXT        NOT NULL,
  is_current            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS voice_versions_founder_idx
  ON founder.voice_versions (founder_id);

CREATE UNIQUE INDEX IF NOT EXISTS voice_versions_founder_current_unique
  ON founder.voice_versions (founder_id)
  WHERE is_current = TRUE;
