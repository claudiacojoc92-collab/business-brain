-- V061: Known-entity market CONTEXT (Wave 3 slice 1). NOT market discovery — the founder (or a founder-
-- confirmed BB suggestion) names an entity; BB retrieves that entity's OWN public website via the robots-
-- respecting connector. Observation (what the source publicly claims) and inference (what BB tentatively
-- concludes) are stored in SEPARATE columns, never merged. Findings are append-only with full provenance.
-- No FK cascade by design; deletion coverage is explicit in delete.service.

CREATE TABLE IF NOT EXISTS business.market_entity (
  id               TEXT        PRIMARY KEY,
  founder_id       TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  normalized_name  TEXT        NOT NULL,                      -- trim+lowercase; dedupe key per founder
  website_url      TEXT,
  entity_type      TEXT        NOT NULL DEFAULT 'direct',     -- direct | indirect | alternative | reference
  origin           TEXT        NOT NULL,                      -- founder_added | bb_suggested
  relevance_status TEXT        NOT NULL DEFAULT 'proposed',   -- proposed | confirmed | dismissed
  relevance_note   TEXT,                                      -- founder's reason / relevance
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_at     TIMESTAMPTZ,
  UNIQUE (founder_id, normalized_name)                        -- adding the same entity twice updates, not duplicates
);
CREATE INDEX IF NOT EXISTS idx_market_entity_founder ON business.market_entity (founder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS business.market_finding (
  id                     TEXT        PRIMARY KEY,
  founder_id             TEXT        NOT NULL,
  market_entity_id       TEXT        NOT NULL,
  source_url             TEXT        NOT NULL,
  canonical_url          TEXT,
  source_title           TEXT,
  source_type            TEXT        NOT NULL DEFAULT 'website', -- provenance: the retrieval source kind
  retrieved_at           TIMESTAMPTZ NOT NULL,
  retrieval_adapter      TEXT        NOT NULL,                   -- e.g. 'website-connector'
  extraction_version     TEXT        NOT NULL,
  observed_text          TEXT        NOT NULL,                   -- what the source publicly presents (OBSERVED)
  evidence_fragment_id   TEXT,                                   -- link to evidence.fragments when stored there
  inference_text         TEXT,                                   -- SEPARATE — what BB tentatively concludes
  epistemic_status       TEXT        NOT NULL,                   -- OBSERVED | SYNTHESIZED_FROM_OBSERVED | HYPOTHESIS | NEEDS_MORE_EVIDENCE
  relevance_to_founder   TEXT,
  founder_response       TEXT        NOT NULL DEFAULT 'unreviewed', -- unreviewed | confirmed | dismissed | qualified
  founder_qualification  TEXT,
  supersedes_id          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_finding_entity ON business.market_finding (founder_id, market_entity_id, created_at);

COMMENT ON TABLE business.market_entity IS 'Wave 3: founder-scoped known market entities (competitor/alternative/reference). founder_added or bb_suggested(unverified until confirmed).';
COMMENT ON TABLE business.market_finding IS 'Wave 3: append-only public-evidence findings. observed_text (self-claim) and inference_text kept SEPARATE; full provenance; never asserts demand/share/superiority.';
