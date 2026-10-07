-- V055: Understanding->Audit slice — append-only founder RecognitionEvent log (Commit 5).
--
-- Founder verdicts on observed statements. Append-only, business-scoped: rows are never mutated or
-- deleted; the effective RecognitionState is DERIVED downstream by projection over event order.
-- No prior snapshot is loaded and no confidence/scope/corpus/context is compared or stored here.
--
-- Ordering authority is `append_seq`, a per-business monotonic counter allocated under a row lock
-- (recognition_seq, SELECT ... FOR UPDATE) so concurrent appends serialize deterministically. The
-- assigned id (ULID) and `at` (wall clock) carry NO ordering authority. Idempotency is by
-- (business_ref, client_event_id); a reused clientEventId with a different payload must fail loudly.

CREATE TABLE IF NOT EXISTS understanding.recognition_seq (
  business_ref TEXT   NOT NULL,
  seq          BIGINT NOT NULL DEFAULT 0,   -- last allocated append_seq for this business
  PRIMARY KEY (business_ref)
);

CREATE TABLE IF NOT EXISTS understanding.recognition_event (
  business_ref          TEXT        NOT NULL,
  id                    TEXT        NOT NULL,   -- assigned RecognitionEventId (ULID); NOT an ordering key
  append_seq            BIGINT      NOT NULL,   -- per-business monotonic append order (the ordering authority)
  snapshot_id           TEXT        NOT NULL,
  statement_semantic_key TEXT       NOT NULL,   -- history() key: carry-forward is projected over this
  statement_version_id  TEXT        NOT NULL,   -- exact-version applicability
  response              TEXT        NOT NULL,   -- founder_recognized | founder_qualified | founder_rejected
  note                  TEXT,                   -- optional founder-authored free text
  at                    TIMESTAMPTZ NOT NULL,   -- operational; NOT an ordering key
  client_event_id       TEXT        NOT NULL,   -- idempotency key (business-scoped)
  PRIMARY KEY (business_ref, id),
  UNIQUE (business_ref, append_seq),
  UNIQUE (business_ref, client_event_id)
);

-- history(businessRef, semanticKey) ordered by append_seq: the projection read path.
CREATE INDEX IF NOT EXISTS idx_understanding_recognition_event_semantic
  ON understanding.recognition_event (business_ref, statement_semantic_key, append_seq);
-- latestForVersion(businessRef, snapshotId): direct-event lookups for a snapshot.
CREATE INDEX IF NOT EXISTS idx_understanding_recognition_event_snapshot
  ON understanding.recognition_event (business_ref, snapshot_id, append_seq);

COMMENT ON TABLE understanding.recognition_event IS
  'Append-only founder RecognitionEvents. Effective RecognitionState is derived by projection; rows are never mutated.';
COMMENT ON TABLE understanding.recognition_seq IS
  'Per-business append_seq counter for recognition_event; allocated under SELECT ... FOR UPDATE.';
