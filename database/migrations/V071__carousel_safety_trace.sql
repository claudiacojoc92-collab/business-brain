-- V071: Slice 6 — Carousel immutable claim-safety trace. UNSHIPPED (feature/business-brain-v1).
-- One append-only row per generation/revision ATTEMPT records the governing decision of the frozen
-- proposition-safety kernel (Layer 1/2/3, block + full-asset): the authorization snapshot ref + contract/
-- judge hashes, the deterministic + semantic findings (attributed), the repair reasons, and the final
-- disposition. No chain-of-thought, no secrets — hashes/ids suffice. version_id is NULL when the attempt
-- failed closed (no version was persisted).

CREATE TABLE IF NOT EXISTS workspace.carousel_safety_trace (
  trace_id                  TEXT        PRIMARY KEY,
  business_id               TEXT        NOT NULL,
  asset_id                  TEXT        NOT NULL,
  version_id                TEXT,
  attempt                   INTEGER     NOT NULL,
  authorization_snapshot_id TEXT        NOT NULL,
  proposition_contract_hash TEXT        NOT NULL,
  judge_model_id            TEXT,
  judge_prompt_hash         TEXT,
  layer1_findings           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  layer2_permitted          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  semantic_block_findings   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  full_asset_findings       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  repair_reasons            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  disposition               TEXT        NOT NULL,
  produced_at               TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS carousel_safety_trace_asset_idx ON workspace.carousel_safety_trace (business_id, asset_id, produced_at ASC);
