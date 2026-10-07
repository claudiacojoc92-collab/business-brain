-- V052: Understanding→Audit slice — fixture-ingestion persistence (Commit 2).
--
-- Append-only, business-scoped evidence for the perception layer. Every row carries `business_ref`
-- and is keyed (business_ref, id): content-addressed ids are business-agnostic by design, so identical
-- content in two businesses yields two isolated rows (a business only ever reads its own key).
--
-- Immutability is by discipline (the app never UPDATEs raw_capture / normalized_observation /
-- corpus_revision; identical content-addressed inserts are idempotent no-ops). Only the pointer table
-- is mutable, and it is a projection, not evidence. No wall-clock value participates in any id.

CREATE SCHEMA IF NOT EXISTS understanding;

CREATE TABLE IF NOT EXISTS understanding.raw_capture (
  business_ref     TEXT        NOT NULL,
  id               TEXT        NOT NULL,          -- content-addressed (sha256 hex)
  source           TEXT        NOT NULL,
  external_id      TEXT        NOT NULL,
  captured_payload JSONB       NOT NULL,          -- faithful, full source entry (fidelity)
  captured_at      TIMESTAMPTZ NOT NULL,          -- Clock metadata; NOT part of id
  PRIMARY KEY (business_ref, id)
);

CREATE TABLE IF NOT EXISTS understanding.normalized_observation (
  business_ref   TEXT        NOT NULL,
  id             TEXT        NOT NULL,            -- content-addressed (folds in normalization rule version)
  raw_capture_id TEXT        NOT NULL,
  kind           TEXT        NOT NULL,            -- 'publication'
  payload        JSONB       NOT NULL,            -- normalized caption/mediaType/occurredAt/bio
  extraction     JSONB       NOT NULL,            -- rule/version + declared information loss
  captured_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (business_ref, id)
);
CREATE INDEX IF NOT EXISTS idx_understanding_obs_capture
  ON understanding.normalized_observation (business_ref, raw_capture_id);

CREATE TABLE IF NOT EXISTS understanding.corpus_revision (
  business_ref                TEXT        NOT NULL,
  id                          TEXT        NOT NULL,   -- sha256(orderedObservationIds, activeFacetCorrectionIds)
  observation_ids             JSONB       NOT NULL,   -- ordered (source order) — order is semantic
  active_facet_correction_ids JSONB       NOT NULL,   -- [] in Commit 2
  created_at                  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (business_ref, id)
);

-- Mutable projection: the current corpus + understanding-context revision per business.
CREATE TABLE IF NOT EXISTS understanding.revision_pointer (
  business_ref                  TEXT        PRIMARY KEY,
  corpus_revision_id            TEXT,
  understanding_ctx_revision_id TEXT,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fixture-ingestion idempotency: (business_ref, fixture_hash) -> corpus_revision_id.
CREATE TABLE IF NOT EXISTS understanding.ingestion_idempotency (
  business_ref       TEXT        NOT NULL,
  fixture_hash       TEXT        NOT NULL,          -- sha256(canonical fixture input)
  corpus_revision_id TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_ref, fixture_hash)
);

COMMENT ON TABLE understanding.raw_capture IS
  'L1 RawCapture — append-only, business-scoped, content-addressed faithful source snapshots (Understanding slice).';
COMMENT ON TABLE understanding.normalized_observation IS
  'L2 NormalizedObservation — append-only, business-scoped, content-addressed publications (Understanding slice).';
COMMENT ON TABLE understanding.corpus_revision IS
  'Immutable corpus checkpoints (content-addressed over ordered observation ids). Prior revisions remain readable.';
