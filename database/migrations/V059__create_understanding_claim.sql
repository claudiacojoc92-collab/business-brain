-- V059: Understanding->Audit slice — append-only Claim log (Commit 9).
--
-- A Claim records ONLY a proposition the system holds. It is NOT truth, evidence, verification, confidence,
-- recognition, a founder declaration, evaluation, or a verdict. Append-only, business-scoped: rows are never
-- mutated or deleted. Contradictory and duplicate propositions coexist; nothing is resolved here. No status,
-- confidence, source, provenance, evidence, or examiner output is stored — those are separate future lanes.
--
-- Ordering authority is `append_seq`, a per-business monotonic counter allocated under a row lock (claim_seq,
-- SELECT ... FOR UPDATE) so concurrent appends serialize deterministically; history/bySubject order by
-- append_seq. The assigned id (ULID) and `recorded_at` (wall clock) carry NO ordering authority. Idempotency
-- is by (business_ref, client_event_id); a reused clientEventId with a different proposition fails loudly.
-- append_seq and client_event_id are persistence-level metadata — NOT part of the Claim domain type.
--
-- ClaimObject is a scalar string | number | boolean. It is stored with an explicit TYPE DISCRIMINATOR plus a
-- typed value column so the exact scalar type round-trips and "1" (string) is never confused with 1 (number),
-- nor "true" with true. Exactly one value column is non-null per row, matching object_type. This
-- discriminated-union shape is a STRUCTURAL persistence invariant (not an epistemic judgment about the
-- claim), so it is enforced with CHECK constraints — this is a different concern from the application-owned
-- ENUM/value validation convention of V054–V058, and does not contradict it. object_number is DOUBLE
-- PRECISION (IEEE-754 float64), matching a JavaScript number; the accepted numeric domain is FINITE numbers,
-- so a CHECK rejects NaN/±Infinity at the storage boundary as well. Negative zero is normalized to +0 by the
-- application before persistence (0 === -0 under the frozen equality), so the database never stores -0.
--
-- subject_* is a founder-chosen SubjectRef (there is no authoritative subject table, so no FK — see repo).

CREATE TABLE IF NOT EXISTS understanding.claim_seq (
  business_ref TEXT   NOT NULL,
  seq          BIGINT NOT NULL DEFAULT 0,   -- last allocated append_seq for this business
  PRIMARY KEY (business_ref)
);

CREATE TABLE IF NOT EXISTS understanding.claim (
  business_ref    TEXT             NOT NULL,
  id              TEXT             NOT NULL,   -- assigned ClaimId (ULID); NOT an ordering key
  append_seq      BIGINT           NOT NULL,   -- per-business monotonic append order (the ordering authority)
  subject_type    TEXT             NOT NULL,   -- SubjectRef.type (business | channel | content_piece | offer | audience_segment)
  subject_id      TEXT             NOT NULL,   -- SubjectRef.id
  predicate       TEXT             NOT NULL,   -- exact original predicate (case- and whitespace-sensitive)
  object_type     TEXT             NOT NULL,   -- 'string' | 'number' | 'boolean' (the ClaimObject discriminator)
  object_text     TEXT,                        -- non-null iff object_type = 'string'
  object_number   DOUBLE PRECISION,            -- non-null iff object_type = 'number' (float64, matches a JS number)
  object_bool     BOOLEAN,                     -- non-null iff object_type = 'boolean'
  recorded_at     TIMESTAMPTZ      NOT NULL,   -- when the SYSTEM recorded the claim; operational; NOT an ordering key
  client_event_id TEXT,                        -- COMMAND identity (business-scoped); NULL for the frozen entity-path append. NEVER the claim id. Not part of the domain type.
  PRIMARY KEY (business_ref, id),
  UNIQUE (business_ref, append_seq),
  -- STRUCTURAL integrity of the typed ClaimObject representation (not epistemic validation):
  CONSTRAINT claim_object_type_valid CHECK (object_type IN ('string', 'number', 'boolean')),
  CONSTRAINT claim_object_shape CHECK (
    (object_type = 'string'  AND object_text IS NOT NULL AND object_number IS NULL     AND object_bool IS NULL) OR
    (object_type = 'number'  AND object_text IS NULL     AND object_number IS NOT NULL AND object_bool IS NULL) OR
    (object_type = 'boolean' AND object_text IS NULL     AND object_number IS NULL     AND object_bool IS NOT NULL)
  ),
  -- accepted numeric domain = FINITE float64 (reject NaN via self-inequality, ±Infinity via bounds):
  CONSTRAINT claim_object_number_finite CHECK (
    object_number IS NULL OR
    (object_number = object_number AND object_number < 'Infinity'::double precision AND object_number > '-Infinity'::double precision)
  )
);

-- history(businessRef): ordered by append_seq.
CREATE INDEX IF NOT EXISTS idx_understanding_claim_seq_order
  ON understanding.claim (business_ref, append_seq);
-- bySubject(businessRef, subject): ordered by append_seq.
CREATE INDEX IF NOT EXISTS idx_understanding_claim_subject
  ON understanding.claim (business_ref, subject_type, subject_id, append_seq);
-- COMMAND identity is unique per business only where it EXISTS (the frozen entity-path append stores NULL and
-- may produce many NULL rows). ClaimId (entity identity) is never stored here — it has its own PK.
CREATE UNIQUE INDEX IF NOT EXISTS idx_understanding_claim_client_event
  ON understanding.claim (business_ref, client_event_id) WHERE client_event_id IS NOT NULL;

COMMENT ON TABLE understanding.claim IS
  'Append-only Claims (propositions the system recorded). Never truth/evaluation; contradictory claims coexist. object stored with a type discriminator.';
COMMENT ON TABLE understanding.claim_seq IS
  'Per-business append_seq counter for claim; allocated under SELECT ... FOR UPDATE.';
