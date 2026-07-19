-- V064: Review lineage + model/prompt provenance (Wave 3 hardening). Make explicit WHICH retrieval adapter,
-- extraction version, inference model, and prompt version produced a review's findings — no longer smuggling
-- the model into extraction_version. Review lineage (prior_successful_review_id, per-finding review_id) already
-- exists (V062); this surfaces the producing components so a founder can see provenance and BB can audit it.

ALTER TABLE business.market_review ADD COLUMN IF NOT EXISTS retrieval_adapter        TEXT; -- e.g. 'website-connector'
ALTER TABLE business.market_review ADD COLUMN IF NOT EXISTS extraction_version       TEXT; -- e.g. 'extract-1'
ALTER TABLE business.market_review ADD COLUMN IF NOT EXISTS inference_model          TEXT; -- e.g. 'claude-sonnet-5'
ALTER TABLE business.market_review ADD COLUMN IF NOT EXISTS inference_prompt_version TEXT; -- e.g. 'market-infer-sys-1'

-- Per-finding model/prompt provenance for INFERENCE findings (NULL for pure observations — those carry
-- retrieval_adapter + extraction_version instead).
ALTER TABLE business.market_finding ADD COLUMN IF NOT EXISTS model_version  TEXT;
ALTER TABLE business.market_finding ADD COLUMN IF NOT EXISTS prompt_version TEXT;

COMMENT ON COLUMN business.market_review.inference_model IS
  'Wave 3 hardening: the inference model id that produced this review''s reading (provenance), kept separate from extraction_version.';
