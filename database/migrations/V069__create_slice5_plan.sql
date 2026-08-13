-- V069: Slice 5 — "30-Day Plan + Today" (Strategy → Execution). UNSHIPPED (feature/business-brain-v1).
-- Immutable PlanVersion content + APPEND-ONLY lifecycle events + APPEND-ONLY action outcome ledger +
-- immutable CreateHandoff. Readiness / status / Today are projections, never stored.

-- Immutable plan content (never updated after insert; content_hash proves immutability).
CREATE TABLE IF NOT EXISTS workspace.plan_version (
  plan_version_id           TEXT        PRIMARY KEY,
  business_id               TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  strategy_version_id       TEXT        NOT NULL,                     -- pinned Current Strategy version
  resource_envelope         JSONB       NOT NULL,                     -- snapshot the plan actually used
  context_version_refs      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  month_direction           TEXT        NOT NULL,
  priorities                JSONB       NOT NULL,                     -- Priority[] with nested Action[]
  current_focus_priority_id TEXT        NOT NULL,
  not_now                   JSONB       NOT NULL DEFAULT '[]'::jsonb, -- may legitimately be empty
  produced_at               TIMESTAMPTZ NOT NULL,
  content_hash              TEXT        NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_version_biz_idx ON workspace.plan_version (business_id, produced_at DESC);

-- Append-only adoption lifecycle. UI status (PROPOSED/ACTIVE/SUPERSEDED) + "one active" is a projection.
CREATE TABLE IF NOT EXISTS workspace.plan_lifecycle_event (
  id              TEXT        PRIMARY KEY,
  business_id     TEXT        NOT NULL,
  plan_version_id TEXT        NOT NULL REFERENCES workspace.plan_version(plan_version_id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL CHECK (kind IN ('proposed','adopted','superseded')),
  at              TIMESTAMPTZ NOT NULL,
  reason          TEXT
);
CREATE INDEX IF NOT EXISTS plan_lifecycle_biz_idx ON workspace.plan_lifecycle_event (business_id, at ASC);

-- Append-only action outcome ledger (readiness is derived from this, never a stored action field).
CREATE TABLE IF NOT EXISTS workspace.plan_action_state (
  id              TEXT        PRIMARY KEY,
  business_id     TEXT        NOT NULL,
  plan_version_id TEXT        NOT NULL REFERENCES workspace.plan_version(plan_version_id) ON DELETE CASCADE,
  action_id       TEXT        NOT NULL,
  outcome         TEXT        NOT NULL CHECK (outcome IN ('done','deferred','skipped')),
  reason          TEXT,
  at              TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_action_state_idx ON workspace.plan_action_state (business_id, plan_version_id, at ASC);

-- Immutable product-level Create handoff (bridge to Slice 6/7; NOT a Voice AuthorizedMessageSpec).
CREATE TABLE IF NOT EXISTS workspace.plan_create_handoff (
  create_handoff_id TEXT        PRIMARY KEY,
  business_id       TEXT        NOT NULL,
  action_id         TEXT        NOT NULL,
  plan_version_id   TEXT        NOT NULL REFERENCES workspace.plan_version(plan_version_id) ON DELETE CASCADE,
  payload           JSONB       NOT NULL,
  produced_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_create_handoff_idx ON workspace.plan_create_handoff (business_id, plan_version_id);

-- Append-only SEMANTIC-QUALITY AUDIT TRACE. Records how each generation was gated (deterministic + semantic),
-- per attempt, plus resolved model id and system-prompt hashes — NO prompt text, no chain-of-thought, no
-- secrets. plan_version_id is NULL when the generation fail-closed (nothing proposed).
CREATE TABLE IF NOT EXISTS workspace.plan_generation_trace (
  id                       TEXT        PRIMARY KEY,
  business_id              TEXT        NOT NULL,
  strategy_version_id      TEXT        NOT NULL,
  plan_version_id          TEXT        REFERENCES workspace.plan_version(plan_version_id) ON DELETE CASCADE,
  model_id                 TEXT,
  draft_contract_hash      TEXT,
  genericity_contract_hash TEXT,
  attempts                 JSONB       NOT NULL,   -- PlanAttemptRecord[] (attempt, disposition, failures)
  final_disposition        TEXT        NOT NULL CHECK (final_disposition IN ('proposed','fail_closed')),
  at                       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_generation_trace_idx ON workspace.plan_generation_trace (business_id, at ASC);
