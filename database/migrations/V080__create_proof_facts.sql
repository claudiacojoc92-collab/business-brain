-- Part 1 — PROOF EXTRACTION. Documented proof on an ingested source (attributed testimonials, credentials,
-- awards, checkable business facts, named case studies, externally-sourced figures) becomes a LICENSABLE
-- proofFact, each carrying DURABLE provenance back to the exact source fragment — answerable months later
-- from the database alone, without re-running extraction (Amendment 1).
--
-- A business's OWN unsourced performance claims (satisfaction/success/improvement %, outcome stats, growth
-- figures, rankings, superlatives with no external source) are NEVER licensable — they are recorded in a
-- SEPARATE, visible-but-excluded store so the line drawn can be audited (Amendment 2). The claim gate is
-- unchanged; this only feeds it, and only with proof that is true-by-construction (someone said it / it is
-- checkable) rather than a number the business invented.

CREATE TABLE IF NOT EXISTS workspace.proof_fact (
  id                 text        PRIMARY KEY,
  business_id        text        NOT NULL,
  kind               text        NOT NULL,          -- testimonial|credential|award|tenure|location|team_size|service_count|case_study|external_sourced_figure
  licensed_text      text        NOT NULL,          -- the WRAPPED reported-speech form actually licensed ("a client stated: …")
  anchor_quote       text        NOT NULL,          -- verbatim substring of the source fragment (deterministically verified)
  attribution        text        NULL,              -- named client / external source, if any
  source_ref         text        NOT NULL,          -- founder-readable page/source label
  source_url         text        NOT NULL,          -- resolvable provenance (NOT NULL — no proofFact without a source)
  source_fingerprint text        NOT NULL,          -- hash of the bound-fragment set at extraction time (cache/staleness key)
  model_id           text        NULL,
  extracted_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proof_fact_business ON workspace.proof_fact (business_id, extracted_at);
CREATE INDEX IF NOT EXISTS idx_proof_fact_fingerprint ON workspace.proof_fact (business_id, source_fingerprint);

-- The business's own unsourced performance claims — EXCLUDED from licensing, kept visible for audit.
CREATE TABLE IF NOT EXISTS workspace.unsourced_claim (
  id                 text        PRIMARY KEY,
  business_id        text        NOT NULL,
  claim_text         text        NOT NULL,          -- the claim as the page states it
  anchor_quote       text        NOT NULL,
  exclusion_reason   text        NOT NULL,          -- self_published_performance_figure|superlative|ranking|outcome_statistic|growth_figure
  source_ref         text        NOT NULL,
  source_url         text        NOT NULL,
  source_fingerprint text        NOT NULL,
  extracted_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unsourced_claim_business ON workspace.unsourced_claim (business_id, extracted_at);
