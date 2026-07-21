-- V082: Strategic Learning Consumption Gate — remediation (ADR-014 amendment). Makes snapshot consumption a mandatory
-- constitutional gate for every NEW recommendation generation, freezes the FULL governed reasoning input (adds
-- public-positioning/market context to the snapshot), records generation provenance, and adopts SHA-256 as the
-- authoritative snapshot-integrity hash. Legacy sessions (generation_contract_version = 0, null snapshot) remain readable
-- but cannot regenerate live. Forward-only; does NOT edit V081. Dev snapshot rows are all removable (0 persistent), so no
-- content-hash backfill is required — the hash_algorithm column records the authoritative algorithm going forward.

-- ── Context snapshot: full-payload + SHA-256 provenance ──────────────────────────────────────────────────
ALTER TABLE business.context_snapshot
  ADD COLUMN IF NOT EXISTS public_positioning_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payload_schema_version     TEXT  NOT NULL DEFAULT 'context-snapshot-2',
  ADD COLUMN IF NOT EXISTS hash_algorithm             TEXT  NOT NULL DEFAULT 'sha256';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'context_snapshot_hash_algorithm_enum') THEN
    ALTER TABLE business.context_snapshot ADD CONSTRAINT context_snapshot_hash_algorithm_enum CHECK (hash_algorithm IN ('sha256'));
  END IF;
END $$;

-- ── Strategic session: mandatory generation contract + provenance ────────────────────────────────────────
ALTER TABLE business.strategic_session
  ADD COLUMN IF NOT EXISTS generation_contract_version INTEGER     NOT NULL DEFAULT 0,  -- 0 = legacy (live), 1 = governed (snapshot required)
  ADD COLUMN IF NOT EXISTS snapshot_content_hash       TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_schema_version     TEXT,
  ADD COLUMN IF NOT EXISTS strategist_version          TEXT,
  ADD COLUMN IF NOT EXISTS prompt_template_hash        TEXT,
  ADD COLUMN IF NOT EXISTS model_configuration         JSONB,
  ADD COLUMN IF NOT EXISTS objective_hash              TEXT,
  ADD COLUMN IF NOT EXISTS generated_at                TIMESTAMPTZ;

DO $$ BEGIN
  -- Governed (v1) rows MUST carry a snapshot; legacy (v0) rows may have a null snapshot. The DB enforces the gate.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strategic_session_generation_contract') THEN
    ALTER TABLE business.strategic_session ADD CONSTRAINT strategic_session_generation_contract
      CHECK (generation_contract_version = 0 OR context_snapshot_id IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN business.strategic_session.generation_contract_version IS 'ADR-014 remediation (V082): 0 = legacy live-context session (read-only, not reproducible); 1 = governed snapshot-bound session (context_snapshot_id + generation provenance required, enforced by CHECK).';
COMMENT ON COLUMN business.context_snapshot.public_positioning_context IS 'ADR-014 remediation (V082): frozen public-positioning/market context — the strategist never reads it live for a snapshot-bound generation.';
COMMENT ON COLUMN business.context_snapshot.hash_algorithm IS 'ADR-014 remediation (V082): authoritative snapshot-integrity hash algorithm — sha256 (replaces the initial FNV-1a).';
