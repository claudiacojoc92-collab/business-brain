CREATE TABLE IF NOT EXISTS memory.voice_signatures (
  founder_id                     TEXT        PRIMARY KEY
    REFERENCES founder.founders(id),
  sentence_structure_preference  TEXT        NOT NULL DEFAULT 'UNKNOWN',
  opening_preference             TEXT        NOT NULL DEFAULT '',
  closing_preference             TEXT        NOT NULL DEFAULT '',
  cta_preference                 TEXT        NOT NULL DEFAULT 'INVITATION',
  vocabulary_register            TEXT        NOT NULL DEFAULT 'Professional',
  confidence                     NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  observation_count              INTEGER     NOT NULL DEFAULT 0,
  last_updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
