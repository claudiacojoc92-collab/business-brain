-- V060: Founder responses to understanding conclusions (Wave 2 item 4). An append-only response LOG,
-- SEPARATE from the synthesis versions — so Confirm/Reject/Partly never inflate understanding versions,
-- yet every response is preserved with full history. Distinct fields per type (accepted vs qualification vs
-- correction) so meanings are never collapsed into one note. A later response supersedes the prior
-- (superseded_by chains history); the effective response is the one with superseded_by IS NULL. The founder's
-- original synthesis + evidence are NEVER rewritten by a response; corrections persist separately as
-- founder-DECLARED evidence (evidence.fragments).

CREATE TABLE IF NOT EXISTS business.conclusion_response (
  id                TEXT        PRIMARY KEY,                 -- ULID (also the "resulting revision id")
  founder_id        TEXT        NOT NULL,
  understanding_id  TEXT        NOT NULL,                    -- the synthesis version the response attaches to
  conclusion_id     TEXT        NOT NULL,
  response_type     TEXT        NOT NULL,                    -- confirmed | partly | corrected | rejected
  accepted_text     TEXT,                                   -- Partly: what the founder accepts (optional)
  qualification_text TEXT,                                  -- Partly: what they qualify/correct
  correction_text   TEXT,                                   -- Correct: the founder's replacement statement
  superseded_by     TEXT,                                   -- id of the response that later replaced this one
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one EFFECTIVE (non-superseded) response per (founder, conclusion) — deterministic latest.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_effective_conclusion_response
  ON business.conclusion_response (founder_id, conclusion_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_conclusion_response_founder ON business.conclusion_response (founder_id, created_at);

COMMENT ON TABLE business.conclusion_response IS
  'Wave 2 item 4: append-only founder responses to conclusions. Confirm/Reject/Partly do not bump synthesis versions; corrections persist separately as declared evidence; supersession preserves history with one effective response.';
