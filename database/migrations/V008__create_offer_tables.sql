CREATE TABLE IF NOT EXISTS founder.offer_versions (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL REFERENCES founder.founders(id),
  version_number        INTEGER     NOT NULL,
  name                  TEXT        NOT NULL,
  primary_promise       TEXT        NOT NULL,
  price_tier            TEXT        NOT NULL,
  sales_mechanism       TEXT        NOT NULL,
  sales_cycle_days      INTEGER,
  maturity              TEXT        NOT NULL DEFAULT 'NEW',
  availability          TEXT        NOT NULL DEFAULT 'OPEN',
  capacity_available    BOOLEAN     NOT NULL DEFAULT TRUE,
  trust_multiplier      NUMERIC(4,2) NOT NULL DEFAULT 1.50,
  planned_launch_date   TIMESTAMPTZ,
  is_current            BOOLEAN     NOT NULL DEFAULT TRUE,
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS offer_versions_founder_idx
  ON founder.offer_versions (founder_id);

CREATE UNIQUE INDEX IF NOT EXISTS offer_versions_founder_current_unique
  ON founder.offer_versions (founder_id)
  WHERE is_current = TRUE;

-- Trigger: derive trust_multiplier from price_tier
CREATE OR REPLACE FUNCTION founder.derive_trust_multiplier()
RETURNS TRIGGER AS $$
BEGIN
  NEW.trust_multiplier := CASE NEW.price_tier
    WHEN 'ACCESSIBLE' THEN 1.00
    WHEN 'MID'        THEN 1.50
    WHEN 'PREMIUM'    THEN 2.00
    ELSE 1.50
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_trust_multiplier ON founder.offer_versions;
CREATE TRIGGER trg_derive_trust_multiplier
  BEFORE INSERT OR UPDATE ON founder.offer_versions
  FOR EACH ROW EXECUTE FUNCTION founder.derive_trust_multiplier();
