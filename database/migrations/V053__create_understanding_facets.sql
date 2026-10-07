-- V053: Understanding->Audit slice — deterministic base facets + effective resolution (Commit 3).
--
-- Append-only, business-scoped, rule/profile-versioned. Content-addressed Facet ids are business-
-- agnostic by design; every row carries business_ref and is keyed (business_ref, id). Facets are never
-- overwritten: a changed rule/profile version appends a new row. Operational timestamps never enter
-- the Facet id. There is deliberately no profileRevision (an extractionProfile change does not change
-- the CorpusRevision).

CREATE TABLE IF NOT EXISTS understanding.facet (
  business_ref       TEXT        NOT NULL,
  id                 TEXT        NOT NULL,   -- content-addressed (sha256 over observation/kind/rule/profile/value)
  observation_id     TEXT        NOT NULL,
  kind               TEXT        NOT NULL,
  value              TEXT        NOT NULL,
  mode               TEXT        NOT NULL,
  confidence         TEXT        NOT NULL,   -- 'high' | 'medium' | 'low' (match reliability only)
  rule_key           TEXT        NOT NULL,
  rule_version       TEXT        NOT NULL,
  extraction_profile TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,   -- operational; NOT part of the id
  PRIMARY KEY (business_ref, id)
);
CREATE INDEX IF NOT EXISTS idx_understanding_facet_obs_profile
  ON understanding.facet (business_ref, observation_id, extraction_profile);
CREATE INDEX IF NOT EXISTS idx_understanding_facet_profile
  ON understanding.facet (business_ref, extraction_profile);

-- Append-only FacetCorrection store. Write workflow (command/route) is deferred to Commit 6; the
-- resolver reads active corrections here to compose effective facets.
CREATE TABLE IF NOT EXISTS understanding.facet_correction (
  business_ref   TEXT        NOT NULL,
  id             TEXT        NOT NULL,
  observation_id TEXT        NOT NULL,
  kind           TEXT        NOT NULL,
  from_value     TEXT        NOT NULL,
  to_value       TEXT        NOT NULL,       -- '' means suppress the base facet
  by             TEXT        NOT NULL,       -- 'founder'
  at             TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (business_ref, id)
);
CREATE INDEX IF NOT EXISTS idx_understanding_facet_correction_obs
  ON understanding.facet_correction (business_ref, observation_id);

-- Extraction-run marker: replay detection + idempotency for (business, corpus, profile).
CREATE TABLE IF NOT EXISTS understanding.facet_extraction_run (
  business_ref       TEXT        NOT NULL,
  corpus_revision_id TEXT        NOT NULL,
  extraction_profile TEXT        NOT NULL,
  facet_count        INTEGER     NOT NULL,
  rule_versions      JSONB       NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (business_ref, corpus_revision_id, extraction_profile)
);

COMMENT ON TABLE understanding.facet IS
  'Append-only deterministic base facets (observable signals only). Business-scoped, rule/profile-versioned; never overwritten.';
COMMENT ON TABLE understanding.facet_correction IS
  'Append-only founder facet corrections. Composed by the EffectiveFacetResolver; write workflow deferred to Commit 6.';
