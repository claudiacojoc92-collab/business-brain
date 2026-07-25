-- V054: Understanding->Audit slice — immutable BusinessSnapshotVersion generation (Commit 4).
--
-- Append-only, business-scoped, content-addressed. A version + its observed statements are written
-- atomically and never mutated; review / recognition / status are NOT stored here (derived later).
-- declaredContext is stored on the version row (empty in Commit 4). Statement identity is the frozen
-- statementVersionId; version identity is the frozen snapshotId. No wall-clock value enters any id.

CREATE TABLE IF NOT EXISTS understanding.snapshot_version (
  business_ref                  TEXT        NOT NULL,
  id                            TEXT        NOT NULL,   -- frozen snapshotId
  corpus_revision_id            TEXT        NOT NULL,
  understanding_ctx_revision_id TEXT        NOT NULL,
  generation_profile_version    TEXT        NOT NULL,
  declared_context              JSONB       NOT NULL,   -- [] in Commit 4
  created_at                    TIMESTAMPTZ NOT NULL,   -- operational; NOT part of id
  supersedes                    TEXT,
  PRIMARY KEY (business_ref, id)
);
CREATE INDEX IF NOT EXISTS idx_understanding_snapshot_version_recent
  ON understanding.snapshot_version (business_ref, created_at DESC);

CREATE TABLE IF NOT EXISTS understanding.snapshot_statement (
  business_ref       TEXT     NOT NULL,
  snapshot_id        TEXT     NOT NULL,
  version_id         TEXT     NOT NULL,   -- frozen statementVersionId
  ordinal            INTEGER  NOT NULL,   -- display order within the snapshot
  semantic_key       TEXT     NOT NULL,   -- frozen snapshotSemanticKey (support-invariant)
  definition_key     TEXT     NOT NULL,
  definition_version INTEGER  NOT NULL,
  subject_type       TEXT     NOT NULL,
  subject_id         TEXT     NOT NULL,
  params             JSONB    NOT NULL,   -- individuating semantic params only (no evidence stats)
  scope              JSONB    NOT NULL,
  confidence         TEXT     NOT NULL,   -- clear | appears | tentative
  provenance_kind    TEXT     NOT NULL,   -- 'observed'
  observation_ids    JSONB    NOT NULL,
  uncertainty        JSONB    NOT NULL,
  unknown_basis      JSONB,
  PRIMARY KEY (business_ref, snapshot_id, version_id)
);
CREATE INDEX IF NOT EXISTS idx_understanding_snapshot_statement_snapshot
  ON understanding.snapshot_statement (business_ref, snapshot_id, ordinal);

COMMENT ON TABLE understanding.snapshot_version IS
  'Immutable BusinessSnapshotVersion (frozen snapshotId). Append-only; review/recognition/status derived elsewhere.';
COMMENT ON TABLE understanding.snapshot_statement IS
  'Immutable observed SnapshotStatements. semantic_key is support-invariant; version_id changes with corpus/scope/confidence.';
