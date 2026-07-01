-- V050: Connect Your World — append-only evidence store (ADR-007 nucleus).
--
-- The "disciplined table" ADR-007 §2 approves: never updated in place, content-addressed
-- ids for dedupe, provenance-bearing. Structural honesty is enforced here as CHECK
-- constraints (belt-and-suspenders with the store-layer gate), so fabrication is
-- unrepresentable, not merely discouraged:
--   * observed fragments MUST carry a real source (source_url NOT NULL);
--   * inferred fragments MUST carry non-empty derived_from (provenance).
-- (declared fragments — conversation, a later slice — carry neither a source_url nor
--  derived_from; permitted by the constraints below.)

CREATE SCHEMA IF NOT EXISTS evidence;

CREATE TABLE IF NOT EXISTS evidence.fragments (
  id              TEXT        PRIMARY KEY,                 -- content-addressed (sha256 hex)
  founder_id      TEXT        NOT NULL,
  source          TEXT        NOT NULL,                    -- e.g. 'website'
  platform        TEXT,                                    -- e.g. host/domain
  source_url      TEXT,                                    -- permalink where applicable
  confidence_kind TEXT        NOT NULL
                    CHECK (confidence_kind IN ('observed','declared','inferred')),
  occurred_at     TIMESTAMPTZ,                             -- when it happened in the world (nullable = honest "unknown")
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),      -- when Business Brain saw it
  visibility      TEXT        NOT NULL DEFAULT 'public'
                    CHECK (visibility IN ('public','private','founder_only')),
  payload         JSONB       NOT NULL,                    -- normalized content
  derived_from    JSONB,                                   -- array of fragment ids; required (non-empty) when inferred

  -- Structural honesty gate (ADR-007): observed needs a source; inferred needs provenance.
  CONSTRAINT observed_has_source
    CHECK (confidence_kind <> 'observed' OR source_url IS NOT NULL),
  CONSTRAINT inferred_has_derivation
    CHECK (
      confidence_kind <> 'inferred'
      OR (derived_from IS NOT NULL
          AND jsonb_typeof(derived_from) = 'array'
          AND jsonb_array_length(derived_from) > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_evidence_founder_source
  ON evidence.fragments (founder_id, source);
CREATE INDEX IF NOT EXISTS idx_evidence_founder_kind
  ON evidence.fragments (founder_id, confidence_kind);

COMMENT ON TABLE evidence.fragments IS
  'Append-only, provenance-bearing evidence (ADR-007). Never updated in place; content-addressed ids dedupe re-runs. Observed=from a source; inferred=carries derived_from; declared=from conversation.';
COMMENT ON COLUMN evidence.fragments.derived_from IS
  'JSON array of fragment ids this was derived from. Non-empty is REQUIRED when confidence_kind = inferred (honesty gate).';
