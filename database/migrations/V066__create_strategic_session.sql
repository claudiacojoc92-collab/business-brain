-- V066: Founder Strategy — durable strategic session + append-only founder responses (Wave 4, first slice).
-- A strategic session answers ONE bounded PRIORITY_DECISION from the stable Waves 1–3 outputs, via the durable
-- worker conventions (DB-authoritative, lease-claimed, restart-safe, atomic READY). The session stores stable
-- reference fields (understanding_version snapshot + context_health) and the FINAL recommendation (with embedded
-- provenance references) — NOT the whole raw assembled context. The generated recommendation is immutable;
-- founder reactions are append-only in strategic_response. No FK cascade; deletion coverage is explicit.

CREATE TABLE IF NOT EXISTS business.strategic_session (
  id                          TEXT        PRIMARY KEY,
  founder_id                  TEXT        NOT NULL,
  status                      TEXT        NOT NULL DEFAULT 'QUEUED', -- QUEUED|PROCESSING|READY|INSUFFICIENT_EVIDENCE|FAILED
  strategic_job               TEXT        NOT NULL,                  -- PRIORITY_DECISION
  subtype                     TEXT        NOT NULL,                  -- CHANNEL_PRIORITY | … | GENERAL_30_DAY_PRIORITY
  question_text               TEXT        NOT NULL,
  decision_horizon            TEXT,
  understanding_version       INTEGER,                              -- snapshot ref (which understanding the reasoning used)
  context_health              JSONB,                                -- missing/stale/contradictory areas + truncated
  recommendation              JSONB,                                -- the immutable StrategicRecommendation (null until READY)
  insufficient_reason         JSONB,                                -- the InsufficientStrategicEvidence (null unless INSUFFICIENT_EVIDENCE)
  failure_category            TEXT,                                 -- MODEL_FAILED | ASSEMBLY_FAILED (FAILED only)
  founder_safe_error          TEXT,
  internal_error_detail       TEXT,                                 -- never exposed to the founder
  prior_successful_session_id TEXT,                                 -- last READY session at create time (preserved on later failure)
  model_id                    TEXT,
  prompt_version              TEXT,
  schema_version              TEXT,
  attempt_count               INTEGER     NOT NULL DEFAULT 1,
  max_attempts                INTEGER     NOT NULL DEFAULT 3,
  claimed_at                  TIMESTAMPTZ,
  lease_expires_at            TIMESTAMPTZ,
  started_at                  TIMESTAMPTZ,
  finished_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One active session per (founder, question) — a double-submit of the same question returns the existing active session.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_strategic_session
  ON business.strategic_session (founder_id, question_text) WHERE status IN ('QUEUED', 'PROCESSING');
CREATE INDEX IF NOT EXISTS idx_strategic_session_founder ON business.strategic_session (founder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS business.strategic_response (
  id            TEXT        PRIMARY KEY,
  founder_id    TEXT        NOT NULL,
  session_id    TEXT        NOT NULL,
  response_type TEXT        NOT NULL,   -- ACCEPT | REJECT | QUALIFY | NEEDS_MORE_EVIDENCE | NOT_RELEVANT_NOW
  qualification TEXT,
  supersedes_id TEXT,
  superseded_at TIMESTAMPTZ,            -- NULL = the effective response
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Exactly one EFFECTIVE (non-superseded) response per session — deterministic latest after refresh.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_effective_strategic_response
  ON business.strategic_response (founder_id, session_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_strategic_response_founder ON business.strategic_response (founder_id, created_at);

COMMENT ON TABLE business.strategic_session IS 'Wave 4: durable Founder Strategy sessions (PRIORITY_DECISION). Immutable recommendation; append-only founder responses; reference-based context snapshot.';
