CREATE TABLE IF NOT EXISTS founder.belief_chains (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL REFERENCES founder.founders(id),
  version_number        INTEGER     NOT NULL,
  beliefs               JSONB       NOT NULL DEFAULT '[]',
  is_current            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS founder.conviction_angles (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL REFERENCES founder.founders(id),
  version_number        INTEGER     NOT NULL,
  statement             TEXT        NOT NULL,
  domain                TEXT        NOT NULL,
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 0.500,
  derived_from          TEXT        NOT NULL,
  is_current            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS belief_chains_founder_idx
  ON founder.belief_chains (founder_id);

CREATE INDEX IF NOT EXISTS conviction_angles_founder_idx
  ON founder.conviction_angles (founder_id);
