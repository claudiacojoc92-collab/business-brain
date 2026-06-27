CREATE TABLE IF NOT EXISTS founder.audiences (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL REFERENCES founder.founders(id),
  description           TEXT        NOT NULL,
  pre_engagement_state  TEXT        NOT NULL,
  sophistication_level  TEXT        NOT NULL,
  primary_platform      TEXT        NOT NULL,
  is_current            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS founder.audience_language_fingerprints (
  id                    TEXT        PRIMARY KEY,
  audience_id           TEXT        NOT NULL REFERENCES founder.audiences(id),
  version_number        INTEGER     NOT NULL DEFAULT 1,
  primary_phrases       JSONB       NOT NULL DEFAULT '[]',
  avoid_phrases         JSONB       NOT NULL DEFAULT '[]',
  emotional_register    TEXT        NOT NULL,
  failed_alternatives   JSONB       NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audiences_founder_idx
  ON founder.audiences (founder_id);
