-- V052: Business Memory v1 — Open Threads. Persisted STATE + history over C's existing grounded
-- tensions (what-matters.ts). This is relationship STATE, NOT evidence and NOT a derived business
-- object: it records which declared↔observed tension is open / recurring / addressed / resolved, and
-- how it got there. It never stores a synthesized fact about the business (no Company/Profile object).
--
-- Identity is the GROUNDED signature — hash(category, declared FIELD(s), observed SOURCE-KEY(s)) —
-- NOT the tension fragment id (which churns every recompute). One thread per (founder, signature).
-- Unlike the append-only evidence store, a thread's STATUS is updated in place; every transition is
-- appended immutably to memory.thread_events, and a thread RESOLVES only with a grounded reason.

CREATE SCHEMA IF NOT EXISTS memory;

CREATE TABLE IF NOT EXISTS memory.threads (
  founder_id        TEXT        NOT NULL,
  signature         TEXT        NOT NULL,                    -- grounded identity (see above)
  category          TEXT        NOT NULL,                    -- tension category (audit/display)
  declared_fields   JSONB       NOT NULL,                    -- sorted array of declared FIELD anchors
  observed_keys     JSONB       NOT NULL,                    -- sorted array of observed SOURCE-KEY anchors
  status            TEXT        NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','recurring','addressed','resolved')),
  current_tension_id TEXT,                                   -- latest matched inferred-fragment id (churny; link only)
  resolved_reason   TEXT
                      CHECK (resolved_reason IN ('handled','decision','tension_gone')),
  recurrence_count  INT         NOT NULL DEFAULT 1,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (founder_id, signature),
  -- A thread is resolved IFF it carries a grounded reason — resolution is never silent.
  CONSTRAINT resolved_iff_reason
    CHECK ((status = 'resolved') = (resolved_reason IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS memory.thread_events (
  id          BIGSERIAL   PRIMARY KEY,
  founder_id  TEXT        NOT NULL,
  signature   TEXT        NOT NULL,
  event       TEXT        NOT NULL
                CHECK (event IN ('opened','recurred','addressed','resolved')),
  reason      TEXT
                CHECK (reason IN ('handled','decision','tension_gone')),  -- grounded reason on 'resolved'
  tension_id  TEXT,                                                       -- inferred-fragment id at this event (audit)
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (founder_id, signature) REFERENCES memory.threads (founder_id, signature) ON DELETE CASCADE,
  -- 'resolved' events must name their grounded reason; other events must not.
  CONSTRAINT resolved_event_has_reason
    CHECK ((event = 'resolved') = (reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_threads_founder_status ON memory.threads (founder_id, status);
CREATE INDEX IF NOT EXISTS idx_thread_events_founder_sig ON memory.thread_events (founder_id, signature);

COMMENT ON TABLE memory.threads IS
  'Business Memory v1 Open Threads: STATE over C tensions, keyed by GROUNDED signature (category + declared field(s) + observed source-key(s)), NOT the churny tension id. Status updated in place; resolves only with a grounded reason.';
COMMENT ON TABLE memory.thread_events IS
  'Immutable append-only history of thread transitions (opened/recurred/addressed/resolved). A resolved event must name its grounded reason (handled/decision/tension_gone).';
