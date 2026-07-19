-- V063: Founder responses to market findings (Wave 3 hardening) — TWO INDEPENDENT judgments per finding,
-- NEVER collapsed into one status:
--   1) accurately_reflects_source — "does this accurately reflect what the public source says?"
--   2) relevance_status           — "does this matter for my business / competitive context?"
-- A finding may be accurate-but-irrelevant, inaccurate-but-attached-to-a-relevant-entity, relevant-only-with-
-- qualification, etc. Accuracy concerns BB's READING of the source; relevance concerns strategic usefulness.
-- Append-only LOG with supersession: a later response supersedes the prior effective one (supersedes_id chains
-- history backward; superseded_at marks a row as no longer effective). The effective response is the single row
-- with superseded_at IS NULL. The original finding (observed_text / inference_text) is NEVER rewritten by a
-- response. No FK cascade by design; deletion coverage is explicit in delete.service.

CREATE TABLE IF NOT EXISTS business.market_finding_response (
  id                          TEXT        PRIMARY KEY,                    -- ULID
  founder_id                  TEXT        NOT NULL,
  market_finding_id           TEXT        NOT NULL,                       -- the finding this response attaches to
  accurately_reflects_source  TEXT        NOT NULL DEFAULT 'unreviewed',  -- unreviewed | yes | partly | no
  relevance_status            TEXT        NOT NULL DEFAULT 'unreviewed',  -- unreviewed | relevant | partly_relevant | not_relevant
  accuracy_qualification      TEXT,                                       -- what is incomplete/overstated/misread (esp. 'partly')
  relevance_qualification     TEXT,                                       -- what limits the relevance (esp. 'partly_relevant')
  supersedes_id               TEXT,                                       -- the prior response this one replaces
  superseded_at               TIMESTAMPTZ,                                -- when THIS row was superseded (NULL = effective)
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one EFFECTIVE (non-superseded) response per (founder, finding) — deterministic latest after refresh.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_effective_market_finding_response
  ON business.market_finding_response (founder_id, market_finding_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_market_finding_response_founder ON business.market_finding_response (founder_id, created_at);

COMMENT ON TABLE business.market_finding_response IS
  'Wave 3 hardening: append-only founder responses to market findings. Source accuracy and business relevance are stored as TWO independent dimensions (never one enum); supersession preserves full history with exactly one effective response; the underlying finding is never rewritten.';
