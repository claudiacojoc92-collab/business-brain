-- V057: Understanding->Audit slice — append-only SnapshotPresentedEvent log (Commit 7).
--
-- A SnapshotPresentedEvent is a narrow marker that a snapshot version was served to the founder.
-- Append-only, business-scoped: rows are never mutated or deleted. Creating one does NOT mint a new
-- SnapshotVersion and does NOT change recognition/review/status — presented is informational, so the
-- Commit 5/6 SnapshotStatus derivation is preserved and BusinessSnapshotView is never persisted here.
--
-- Ordering authority is `append_seq`, a per-business monotonic counter allocated under a row lock
-- (presented_seq, SELECT ... FOR UPDATE) so concurrent appends serialize deterministically; `latest()`
-- orders by append_seq, never by `at`. The assigned id (ULID) and `at` (wall clock) carry NO ordering
-- authority. Idempotency is by (business_ref, client_event_id); a reused clientEventId with a different
-- payload fails loudly. client_event_id is a persistence-level idempotency key — it is NOT part of the
-- SnapshotPresentedEvent domain type.
--
-- The snapshot identity is composite (business_ref, id) — see V054 — so snapshot_id is a scoped
-- reference column, NOT a single-column foreign key.

CREATE TABLE IF NOT EXISTS understanding.presented_seq (
  business_ref TEXT   NOT NULL,
  seq          BIGINT NOT NULL DEFAULT 0,   -- last allocated append_seq for this business
  PRIMARY KEY (business_ref)
);

CREATE TABLE IF NOT EXISTS understanding.snapshot_presented_event (
  business_ref    TEXT        NOT NULL,
  id              TEXT        NOT NULL,   -- assigned SnapshotPresentedEventId (ULID); NOT an ordering key
  append_seq      BIGINT      NOT NULL,   -- per-business monotonic append order (the ordering authority)
  snapshot_id     TEXT        NOT NULL,   -- the presented snapshot (scoped ref; composite snapshot key)
  at              TIMESTAMPTZ NOT NULL,   -- operational; NOT an ordering key
  client_event_id TEXT        NOT NULL,   -- idempotency key (business-scoped); not part of the domain type
  PRIMARY KEY (business_ref, id),
  UNIQUE (business_ref, append_seq),
  UNIQUE (business_ref, client_event_id)
);

-- latest(businessRef, snapshotId) / history(businessRef, snapshotId): ordered by append_seq.
CREATE INDEX IF NOT EXISTS idx_understanding_snapshot_presented_event_snapshot
  ON understanding.snapshot_presented_event (business_ref, snapshot_id, append_seq);

COMMENT ON TABLE understanding.snapshot_presented_event IS
  'Append-only SnapshotPresentedEvents. latest() orders by append_seq; informational — status is derived, never stored.';
COMMENT ON TABLE understanding.presented_seq IS
  'Per-business append_seq counter for snapshot_presented_event; allocated under SELECT ... FOR UPDATE.';
