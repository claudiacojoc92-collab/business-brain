-- V060: Business Brain V1 — versioned lifecycle persistence (vertical slice).
--
-- Additive, self-contained schema `businessbrain`. Models the frozen V1 lifecycle:
-- Founder -> Candidate Version -> Import/Evidence -> Diagnosis/Plan -> Validation ->
-- atomic Promotion -> one Current Version (prior physically removed). Behaviour must
-- match the in-memory reference module (packages/application/src/businessbrain).
--
-- IDENTITY: version_id (ULID) is the ONLY public identity of a complete Version. All other
-- ids (evidence_item_id, root_cause_id, job ids, join keys) are internal and never exposed.
--
-- IMMUTABILITY: artifact rows (evidence/diagnosis/plan/content/joins) are written once and
-- never UPDATEd — immutability is enforced by REPOSITORY DISCIPLINE (no UPDATE statements),
-- the same convention as the understanding slice (V052+). The ONLY mutable rows are the
-- Version role pointer (bb_version.lifecycle_status / promoted_at) and the content-free
-- Refresh Status Record.
--
-- AUDIT: Business Brain lifecycle events REUSE the existing content-free audit.audit_log
-- (V030) written inside the owning transaction — no new audit table is introduced. The
-- metadata JSONB carries only state transitions/markers, never diagnosis/evidence content.
--
-- SAME-VERSION traceability is enforced at the DATABASE level via composite (id, version_id)
-- foreign keys on the join tables. SAME-FOUNDER consistency is authoritative on bb_version
-- (its founder_id) and carried denormalised on children; cross-founder writes are prevented
-- TRANSACTIONALLY by the repository (every child insert uses the Candidate's founder_id).
-- Per-Founder lifecycle exclusivity for atomic Promotion/Discard is enforced TRANSACTIONALLY
-- via SELECT ... FOR UPDATE on the Founder's bb_refresh_status row (the lock anchor).
--
-- There is deliberately NO Execution Plan Version -> Root Cause relation (frozen: Plan
-- references Diagnosis; only Actions reference Recommendations).

CREATE SCHEMA IF NOT EXISTS businessbrain;

-- ---------------------------------------------------------------------------
-- Version bundle root + role pointer (candidate | current).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businessbrain.bb_version (
  version_id       TEXT        NOT NULL,   -- ULID; the sole PUBLIC identity
  founder_id       TEXT        NOT NULL REFERENCES founder.founders(id) ON DELETE CASCADE,
  lifecycle_status TEXT        NOT NULL,   -- 'candidate' | 'current' (persisted resting roles)
  created_at       TIMESTAMPTZ NOT NULL,
  promoted_at      TIMESTAMPTZ,            -- set exactly once, only for 'current'
  PRIMARY KEY (version_id),
  UNIQUE (version_id, founder_id),          -- lets children pin (version_id, founder_id)
  CONSTRAINT bb_version_status_valid CHECK (lifecycle_status IN ('candidate', 'current')),
  CONSTRAINT bb_version_promoted_shape CHECK (
    (lifecycle_status = 'candidate' AND promoted_at IS NULL) OR
    (lifecycle_status = 'current'   AND promoted_at IS NOT NULL)
  )
);
-- Conditional uniqueness: at most one Current and at most one Candidate per Founder.
CREATE UNIQUE INDEX IF NOT EXISTS bb_version_one_current
  ON businessbrain.bb_version (founder_id) WHERE lifecycle_status = 'current';
CREATE UNIQUE INDEX IF NOT EXISTS bb_version_one_candidate
  ON businessbrain.bb_version (founder_id) WHERE lifecycle_status = 'candidate';

-- ---------------------------------------------------------------------------
-- Refresh Status Record — content-free; one per Founder; the lock anchor.
-- Terminal failed/cancelled status survives Candidate deletion (this row is
-- NOT a child of bb_version).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businessbrain.bb_refresh_status (
  founder_id           TEXT        NOT NULL REFERENCES founder.founders(id) ON DELETE CASCADE,
  refresh_reference    TEXT,                    -- new per Refresh; NULL only in the 'none' state
  candidate_version_id TEXT,                    -- internal; may dangle after discard (no FK)
  refresh_state        TEXT        NOT NULL,
  import_state         TEXT        NOT NULL,
  diagnosis_state      TEXT        NOT NULL,
  validation_state     TEXT        NOT NULL,
  failure_category     TEXT,
  transition_marker    BIGINT      NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (founder_id),
  CONSTRAINT bb_refresh_state_valid CHECK (
    refresh_state IN ('none', 'in_progress', 'completed', 'failed', 'cancelled')),
  CONSTRAINT bb_import_state_valid CHECK (
    import_state IN ('none', 'running', 'sufficient', 'insufficient', 'failed')),
  CONSTRAINT bb_diagnosis_state_valid CHECK (
    diagnosis_state IN ('none', 'running', 'produced', 'generation_failed')),
  CONSTRAINT bb_validation_state_valid CHECK (
    validation_state IN ('none', 'passed', 'failed')),
  CONSTRAINT bb_failure_category_valid CHECK (
    failure_category IS NULL OR failure_category IN (
      'connection_lost', 'insufficient_evidence', 'import_temporarily_unavailable',
      'import_timeout', 'diagnosis_unavailable', 'session_lost', 'temporary_failure'))
);

-- ---------------------------------------------------------------------------
-- Import Job attempts (producer). At most one non-terminal attempt per Candidate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businessbrain.bb_import_job (
  import_job_id       TEXT        NOT NULL PRIMARY KEY,
  version_id          TEXT        NOT NULL REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id          TEXT        NOT NULL,
  attempt_ordinal     INTEGER     NOT NULL,
  exec_state          TEXT        NOT NULL,   -- 'queued' | 'running' | 'done'
  outcome             TEXT,                   -- null until done
  failure_reason_code TEXT,
  created_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,
  CONSTRAINT bb_import_exec_valid CHECK (exec_state IN ('queued', 'running', 'done')),
  CONSTRAINT bb_import_outcome_valid CHECK (
    outcome IS NULL OR outcome IN ('sufficient', 'insufficient', 'failed', 'cancelled')),
  CONSTRAINT bb_import_outcome_shape CHECK (outcome IS NULL OR exec_state = 'done')
);
CREATE UNIQUE INDEX IF NOT EXISTS bb_import_one_nonterminal
  ON businessbrain.bb_import_job (version_id) WHERE exec_state <> 'done';

-- ---------------------------------------------------------------------------
-- Diagnosis Job attempts (producer). At most one non-terminal attempt per Candidate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businessbrain.bb_diagnosis_job (
  diagnosis_job_id    TEXT        NOT NULL PRIMARY KEY,
  version_id          TEXT        NOT NULL REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id          TEXT        NOT NULL,
  attempt_ordinal     INTEGER     NOT NULL,
  exec_state          TEXT        NOT NULL,
  outcome             TEXT,
  validation_result   TEXT,
  failure_reason_code TEXT,
  created_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,
  CONSTRAINT bb_diag_exec_valid CHECK (exec_state IN ('queued', 'running', 'done')),
  CONSTRAINT bb_diag_outcome_valid CHECK (
    outcome IS NULL OR outcome IN ('valid', 'validation_failed', 'generation_failed', 'cancelled')),
  CONSTRAINT bb_diag_outcome_shape CHECK (outcome IS NULL OR exec_state = 'done')
);
CREATE UNIQUE INDEX IF NOT EXISTS bb_diag_one_nonterminal
  ON businessbrain.bb_diagnosis_job (version_id) WHERE exec_state <> 'done';

-- ---------------------------------------------------------------------------
-- Evidence Version + Items (one Evidence Version per Version).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businessbrain.bb_evidence_version (
  evidence_version_id TEXT        NOT NULL PRIMARY KEY,
  version_id          TEXT        NOT NULL UNIQUE REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id          TEXT        NOT NULL,
  item_count          INTEGER     NOT NULL,
  window_descriptor   TEXT,
  created_at          TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS businessbrain.bb_evidence_item (
  evidence_item_id    TEXT             NOT NULL PRIMARY KEY,
  evidence_version_id TEXT             NOT NULL REFERENCES businessbrain.bb_evidence_version(evidence_version_id) ON DELETE CASCADE,
  version_id          TEXT             NOT NULL REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id          TEXT             NOT NULL,
  kind                TEXT             NOT NULL,
  measure_value       DOUBLE PRECISION,
  claim_label         TEXT             NOT NULL,
  created_at          TIMESTAMPTZ      NOT NULL,
  UNIQUE (evidence_item_id, version_id),   -- lets joins pin same-version
  CONSTRAINT bb_ei_kind_valid CHECK (kind IN ('proportion', 'presence', 'absence')),
  CONSTRAINT bb_ei_value_finite CHECK (
    measure_value IS NULL OR
    (measure_value = measure_value
     AND measure_value < 'Infinity'::double precision
     AND measure_value > '-Infinity'::double precision))
);

-- ---------------------------------------------------------------------------
-- Diagnosis Version + sections (one per Version). Artifact traceability: Diagnosis -> Evidence.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businessbrain.bb_diagnosis_version (
  diagnosis_version_id TEXT        NOT NULL PRIMARY KEY,
  version_id           TEXT        NOT NULL UNIQUE REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id           TEXT        NOT NULL,
  evidence_version_ref TEXT        NOT NULL REFERENCES businessbrain.bb_evidence_version(evidence_version_id) ON DELETE CASCADE,
  business_reality     TEXT        NOT NULL,
  cannot_yet_know      TEXT        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL
);

-- Evidence Section of the Diagnosis: claim statements (business text) whose measures
-- are a projection of Evidence Items chosen for that claim. Same-Version enforced via
-- composite FKs. This is the ONLY diagnosis section that presents metrics.
CREATE TABLE IF NOT EXISTS businessbrain.bb_evidence_claim (
  evidence_claim_id    TEXT        NOT NULL PRIMARY KEY,
  diagnosis_version_id TEXT        NOT NULL REFERENCES businessbrain.bb_diagnosis_version(diagnosis_version_id) ON DELETE CASCADE,
  version_id           TEXT        NOT NULL REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id           TEXT        NOT NULL,
  ordinal              INTEGER     NOT NULL,
  claim_statement      TEXT        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL,
  UNIQUE (evidence_claim_id, version_id)
);

CREATE TABLE IF NOT EXISTS businessbrain.bb_evidence_claim_measure (
  evidence_claim_id TEXT    NOT NULL,
  evidence_item_id  TEXT    NOT NULL,
  version_id        TEXT    NOT NULL,
  founder_id        TEXT    NOT NULL,
  ordinal           INTEGER NOT NULL,
  PRIMARY KEY (evidence_claim_id, evidence_item_id),
  FOREIGN KEY (evidence_claim_id, version_id)
    REFERENCES businessbrain.bb_evidence_claim (evidence_claim_id, version_id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_item_id, version_id)
    REFERENCES businessbrain.bb_evidence_item (evidence_item_id, version_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS businessbrain.bb_business_consequence (
  id                   TEXT        NOT NULL PRIMARY KEY,
  diagnosis_version_id TEXT        NOT NULL REFERENCES businessbrain.bb_diagnosis_version(diagnosis_version_id) ON DELETE CASCADE,
  version_id           TEXT        NOT NULL REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id           TEXT        NOT NULL,
  ordinal              INTEGER     NOT NULL,
  statement            TEXT        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS businessbrain.bb_root_cause (
  root_cause_id        TEXT        NOT NULL PRIMARY KEY,
  diagnosis_version_id TEXT        NOT NULL REFERENCES businessbrain.bb_diagnosis_version(diagnosis_version_id) ON DELETE CASCADE,
  version_id           TEXT        NOT NULL REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id           TEXT        NOT NULL,
  ordinal              INTEGER     NOT NULL,
  statement            TEXT        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL,
  UNIQUE (root_cause_id, version_id)
);

CREATE TABLE IF NOT EXISTS businessbrain.bb_recommendation (
  recommendation_id    TEXT        NOT NULL PRIMARY KEY,
  diagnosis_version_id TEXT        NOT NULL REFERENCES businessbrain.bb_diagnosis_version(diagnosis_version_id) ON DELETE CASCADE,
  version_id           TEXT        NOT NULL REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id           TEXT        NOT NULL,
  ordinal              INTEGER     NOT NULL,
  statement            TEXT        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL,
  UNIQUE (recommendation_id, version_id)
);

-- ---------------------------------------------------------------------------
-- Execution Plan Version + Actions (phases embedded on actions). One per Version.
-- Artifact traceability: Execution Plan -> Diagnosis (NEVER -> Root Cause).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businessbrain.bb_execution_plan_version (
  execution_plan_version_id TEXT        NOT NULL PRIMARY KEY,
  version_id                TEXT        NOT NULL UNIQUE REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id                TEXT        NOT NULL,
  diagnosis_version_ref     TEXT        NOT NULL REFERENCES businessbrain.bb_diagnosis_version(diagnosis_version_id) ON DELETE CASCADE,
  created_at                TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS businessbrain.bb_execution_plan_action (
  action_id                 TEXT        NOT NULL PRIMARY KEY,
  execution_plan_version_id TEXT        NOT NULL REFERENCES businessbrain.bb_execution_plan_version(execution_plan_version_id) ON DELETE CASCADE,
  version_id                TEXT        NOT NULL REFERENCES businessbrain.bb_version(version_id) ON DELETE CASCADE,
  founder_id                TEXT        NOT NULL,
  phase_label               TEXT        NOT NULL,
  phase_ordinal             INTEGER     NOT NULL,
  sequence                  INTEGER     NOT NULL,   -- 1-based within phase; presentation only
  statement                 TEXT        NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL,
  UNIQUE (action_id, version_id)
);

-- ---------------------------------------------------------------------------
-- Content-traceability joins. Composite (id, version_id) FKs enforce SAME-VERSION
-- at the database level. There is NO action -> root_cause and NO plan -> root_cause join.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businessbrain.bb_rc_evidence (
  root_cause_id    TEXT NOT NULL,
  evidence_item_id TEXT NOT NULL,
  version_id       TEXT NOT NULL,
  founder_id       TEXT NOT NULL,
  PRIMARY KEY (root_cause_id, evidence_item_id),
  FOREIGN KEY (root_cause_id, version_id)
    REFERENCES businessbrain.bb_root_cause (root_cause_id, version_id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_item_id, version_id)
    REFERENCES businessbrain.bb_evidence_item (evidence_item_id, version_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS businessbrain.bb_rec_rootcause (
  recommendation_id TEXT NOT NULL,
  root_cause_id     TEXT NOT NULL,
  version_id        TEXT NOT NULL,
  founder_id        TEXT NOT NULL,
  PRIMARY KEY (recommendation_id, root_cause_id),
  FOREIGN KEY (recommendation_id, version_id)
    REFERENCES businessbrain.bb_recommendation (recommendation_id, version_id) ON DELETE CASCADE,
  FOREIGN KEY (root_cause_id, version_id)
    REFERENCES businessbrain.bb_root_cause (root_cause_id, version_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS businessbrain.bb_action_rec (
  action_id         TEXT NOT NULL,
  recommendation_id TEXT NOT NULL,
  version_id        TEXT NOT NULL,
  founder_id        TEXT NOT NULL,
  PRIMARY KEY (action_id, recommendation_id),
  FOREIGN KEY (action_id, version_id)
    REFERENCES businessbrain.bb_execution_plan_action (action_id, version_id) ON DELETE CASCADE,
  FOREIGN KEY (recommendation_id, version_id)
    REFERENCES businessbrain.bb_recommendation (recommendation_id, version_id) ON DELETE CASCADE
);

-- Ownership / lookup indexes.
CREATE INDEX IF NOT EXISTS bb_version_founder_idx ON businessbrain.bb_version (founder_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS bb_evidence_item_ev_idx ON businessbrain.bb_evidence_item (evidence_version_id);
CREATE INDEX IF NOT EXISTS bb_root_cause_dv_idx ON businessbrain.bb_root_cause (diagnosis_version_id);
CREATE INDEX IF NOT EXISTS bb_recommendation_dv_idx ON businessbrain.bb_recommendation (diagnosis_version_id);
CREATE INDEX IF NOT EXISTS bb_action_epv_idx ON businessbrain.bb_execution_plan_action (execution_plan_version_id);

COMMENT ON TABLE businessbrain.bb_version IS
  'Business Brain Version bundle root. version_id is the only public identity. Role pointer (candidate|current) is the only mutable field; content is immutable by repository discipline.';
COMMENT ON TABLE businessbrain.bb_refresh_status IS
  'Content-free Refresh Status Record; one per Founder; the per-Founder lifecycle lock anchor. Terminal status survives Candidate deletion. Never stores content, job ids, attempt counts, prompts, or provider payloads.';
