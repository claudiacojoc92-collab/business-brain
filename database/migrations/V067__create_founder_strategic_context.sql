-- V067: Founder Strategic Context — append-only, founder-owned strategic operating conditions (Wave 4, slice 1).
-- The explicit, inspectable, temporal, revisable set of conditions under which the founder's strategy must work:
-- five kinds (GOAL | CONSTRAINT | RESOURCE | STRATEGIC_PREFERENCE | DECISION_HORIZON), founder-declared/confirmed
-- only. Append-only VERSIONS of a logical item; EXACTLY ONE active version per logical item (partial unique index).
-- A revision inserts the next version and flips the prior effective row to SUPERSEDED in one transaction; retire
-- flips ACTIVE -> RETIRED. History is never overwritten. Founder-scoped; no FK cascade (delete coverage explicit).
-- Governed by docs/governance/founder-strategic-context-contract.md.

CREATE TABLE IF NOT EXISTS business.founder_strategic_context_item (
  id                  TEXT        PRIMARY KEY,
  founder_id          TEXT        NOT NULL,
  logical_item_id     TEXT        NOT NULL,                 -- stable identity of the "thing" across revisions
  version             INTEGER     NOT NULL,
  kind                TEXT        NOT NULL,                 -- GOAL | CONSTRAINT | RESOURCE | STRATEGIC_PREFERENCE | DECISION_HORIZON
  statement           TEXT        NOT NULL,
  category            TEXT        NOT NULL,                 -- founder-legible sub-category (mirrors metadata.category where present)
  scope               TEXT        NOT NULL,                 -- GLOBAL_STRATEGY | CURRENT_PRIORITY | MARKETING | OFFER | …
  source              TEXT        NOT NULL,                 -- FOUNDER_DECLARED | FOUNDER_CONFIRMED | IMPORTED_ACCEPTED | VERIFIED_SYSTEM_RECORD
  status              TEXT        NOT NULL DEFAULT 'ACTIVE',-- ACTIVE | RETIRED | SUPERSEDED
  effective_from      TIMESTAMPTZ NOT NULL,
  effective_until     TIMESTAMPTZ,                          -- NULL = open-ended
  review_at           TIMESTAMPTZ,
  metadata            JSONB       NOT NULL,                 -- discriminated per-kind, validated at the domain layer
  supersedes_item_id  TEXT,                                 -- the effective version this one replaced
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only versioning: a (founder, logical item, version) tuple is unique and never rewritten.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fsc_founder_logical_version
  ON business.founder_strategic_context_item (founder_id, logical_item_id, version);

-- EXACTLY ONE effective (ACTIVE) version per logical item — the core invariant. A revision must supersede the
-- prior ACTIVE row in the same transaction before inserting the new ACTIVE row, or this index rejects it.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fsc_active_per_logical
  ON business.founder_strategic_context_item (founder_id, logical_item_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_fsc_founder_status ON business.founder_strategic_context_item (founder_id, status);
CREATE INDEX IF NOT EXISTS idx_fsc_founder_logical ON business.founder_strategic_context_item (founder_id, logical_item_id, version DESC);

COMMENT ON TABLE business.founder_strategic_context_item IS 'Wave 4: Founder Strategic Context (5 kinds). Append-only versions; one ACTIVE per logical item; temporal (effective_from/until, review_at) + scoped; founder-declared only; consumed by StrategicContextAssembler via the effective resolver.';
