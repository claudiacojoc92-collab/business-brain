-- V058: Understanding->Audit slice — append-only FounderDeclaration log (Commit 8).
--
-- A FounderDeclaration records what the founder EXPLICITLY declares. It is NOT verified truth, recognition,
-- review, presentation, correction, evidence, or a confidence/status change. Append-only, business-scoped:
-- rows are never mutated or deleted. Declarations never enter the observed lane and never alter
-- SnapshotStatus, recognition, review, or presentation. `supersedes` is the founder's OWN optional pointer,
-- recorded verbatim and never resolved — it is founder-owned data, not snapshot lineage.
--
-- Ordering authority is `append_seq`, a per-business monotonic counter allocated under a row lock
-- (declaration_seq, SELECT ... FOR UPDATE) so concurrent appends serialize deterministically; `history`
-- orders by append_seq. The assigned id (ULID) and `declared_at` (wall clock) carry NO ordering authority.
-- Idempotency is by (business_ref, client_event_id); a reused clientEventId with a different founder intent
-- fails loudly. client_event_id is a persistence-level idempotency key — it is NOT part of the domain type.
--
-- subject_* and supersedes are founder-owned payload; there is deliberately NO foreign key (a declaration
-- references no snapshot/statement, and `supersedes` must stay unresolved).

CREATE TABLE IF NOT EXISTS understanding.declaration_seq (
  business_ref TEXT   NOT NULL,
  seq          BIGINT NOT NULL DEFAULT 0,   -- last allocated append_seq for this business
  PRIMARY KEY (business_ref)
);

CREATE TABLE IF NOT EXISTS understanding.founder_declaration (
  business_ref    TEXT        NOT NULL,
  id              TEXT        NOT NULL,   -- assigned DeclarationId (ULID); NOT an ordering key
  append_seq      BIGINT      NOT NULL,   -- per-business monotonic append order (the ordering authority)
  kind            TEXT        NOT NULL,   -- self_report | intent | decision | objective | preference | constraint
  subject_type    TEXT        NOT NULL,   -- founder-chosen subject (SubjectRef)
  subject_id      TEXT        NOT NULL,
  statement       TEXT        NOT NULL,   -- founder-authored assertion (free text)
  provenance      TEXT        NOT NULL,   -- always 'founder_declared'
  declared_at     TIMESTAMPTZ NOT NULL,   -- operational; NOT an ordering key
  supersedes      TEXT,                   -- founder's OWN optional pointer; recorded, never resolved
  client_event_id TEXT        NOT NULL,   -- idempotency key (business-scoped); not part of the domain type
  PRIMARY KEY (business_ref, id),
  UNIQUE (business_ref, append_seq),
  UNIQUE (business_ref, client_event_id)
);

-- history(businessRef) and effectiveUnderstanding(businessRef): ordered by append_seq (kind filter is applied in SQL).
CREATE INDEX IF NOT EXISTS idx_understanding_founder_declaration_seq
  ON understanding.founder_declaration (business_ref, append_seq);
CREATE INDEX IF NOT EXISTS idx_understanding_founder_declaration_kind
  ON understanding.founder_declaration (business_ref, kind, append_seq);

-- Explicit "Save to my profile" link between a statement's stable semanticKey and a declaration.
-- Append-only set; the whole row is its own identity, so re-linking is idempotent. Independent of
-- recognition (a link NEVER turns an observed statement's recognition into a declared state).
CREATE TABLE IF NOT EXISTS understanding.statement_declaration_link (
  business_ref            TEXT    NOT NULL,
  statement_semantic_key  TEXT    NOT NULL,
  declaration_id          TEXT    NOT NULL,
  created_from_explicit_save BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (business_ref, statement_semantic_key, declaration_id)
);

COMMENT ON TABLE understanding.founder_declaration IS
  'Append-only FounderDeclarations (what the founder explicitly declared). Never truth/recognition/status; supersedes recorded, not resolved.';
COMMENT ON TABLE understanding.declaration_seq IS
  'Per-business append_seq counter for founder_declaration; allocated under SELECT ... FOR UPDATE.';
COMMENT ON TABLE understanding.statement_declaration_link IS
  'Explicit-save links between a statement semanticKey and a declaration. Append-only set; never changes recognition.';
