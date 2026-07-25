-- V056: Understanding->Audit slice — append-only founder SnapshotReview log (Commit 6).
--
-- A SnapshotReview is the founder's global verdict on a snapshot. Append-only, business-scoped: rows are
-- never mutated or deleted. Reviews do NOT change per-statement recognition (Commit 5 projection is frozen),
-- and SnapshotStatus is DERIVED downstream (BusinessSnapshotView) — it is never persisted here.
--
-- Ordering authority is `append_seq`, a per-business monotonic counter allocated under a row lock
-- (review_seq, SELECT ... FOR UPDATE) so concurrent appends serialize deterministically; `latest()` orders
-- by append_seq, never by `at`. The assigned id (ULID) and `at` (wall clock) carry NO ordering authority.
-- Idempotency is by (business_ref, client_event_id); a reused clientEventId with a different payload fails
-- loudly. client_event_id is a persistence-level idempotency key — it is NOT part of the SnapshotReview
-- domain type.

CREATE TABLE IF NOT EXISTS understanding.review_seq (
  business_ref TEXT   NOT NULL,
  seq          BIGINT NOT NULL DEFAULT 0,   -- last allocated append_seq for this business
  PRIMARY KEY (business_ref)
);

CREATE TABLE IF NOT EXISTS understanding.snapshot_review (
  business_ref    TEXT        NOT NULL,
  id              TEXT        NOT NULL,   -- assigned SnapshotReviewId (ULID); NOT an ordering key
  append_seq      BIGINT      NOT NULL,   -- per-business monotonic append order (the ordering authority)
  snapshot_id     TEXT        NOT NULL,
  response        TEXT        NOT NULL,   -- frame_broadly_recognized | corrections_requested | continued_without_review
  at              TIMESTAMPTZ NOT NULL,   -- operational; NOT an ordering key
  client_event_id TEXT        NOT NULL,   -- idempotency key (business-scoped); not part of the domain type
  PRIMARY KEY (business_ref, id),
  UNIQUE (business_ref, append_seq),
  UNIQUE (business_ref, client_event_id)
);

-- latest(businessRef, snapshotId) / history(businessRef, snapshotId): ordered by append_seq.
CREATE INDEX IF NOT EXISTS idx_understanding_snapshot_review_snapshot
  ON understanding.snapshot_review (business_ref, snapshot_id, append_seq);

COMMENT ON TABLE understanding.snapshot_review IS
  'Append-only founder SnapshotReviews. latest() orders by append_seq; SnapshotStatus is derived, never stored.';
COMMENT ON TABLE understanding.review_seq IS
  'Per-business append_seq counter for snapshot_review; allocated under SELECT ... FOR UPDATE.';
