-- V089: Clarity / Sensemaking slice — the cognitive entry point BEFORE a Strategy Thread. A founder arrives with a tension
-- ("everyone says run ads, but I'm not sure ads are the problem"), not a clean strategic question. This slice lets Business
-- Brain audit what is actually happening — separating what is known, assumed, unknown, and in conflict — and produce a
-- plain-language CLARITY result, WITHOUT jumping to a recommendation and WITHOUT silently changing Understanding.
--
-- Constitutional boundaries enforced here (product rules 1-3, 6, 14):
--   * A concern's conversation is append-only testimony (concern_message).
--   * A clarity_result is an IMMUTABLE structured assessment for one Business-Brain turn (never edited; a later turn is a
--     new row). It answers no "you should"; it creates no decision.
--   * proposed_understanding_change is PENDING until the founder explicitly accepts/rejects it. Conversation NEVER writes
--     confirmed Understanding; only an explicit founder action (a separate route) may accept a proposal. The proposed
--     CONTENT is immutable after creation — only its resolution (status/resolved_at/resulting_reference) may change, once,
--     one-way. This makes "Business Brain proposes; the founder confirms" a database guarantee, not a UI convention.
--
-- V1 scope: founder_id IS the single active Business (the codebase scopes everything by founder_id; no Business table is
-- introduced — future-compatible, a business_id can be added later without collapsing any distinction). Forward-only.

-- ── 1. concern — the sensemaking conversation head (MUTABLE head; its history lives in the append-only tables below) ──
CREATE TABLE IF NOT EXISTS business.concern (
  id                       TEXT        PRIMARY KEY,
  founder_id               TEXT        NOT NULL,
  original_input           TEXT        NOT NULL,             -- the founder's first words, preserved verbatim
  clarified_concern        TEXT,                             -- the current clarified issue (evolves; null until clarified)
  status                   TEXT        NOT NULL DEFAULT 'open', -- open | clarified | crystallized | closed
  crystallized_session_id  TEXT,                             -- set ONLY when the founder turns it into a Strategy Thread
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'concern_status_enum') THEN
    ALTER TABLE business.concern ADD CONSTRAINT concern_status_enum
      CHECK (status IN ('open','clarified','crystallized','closed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_concern_founder ON business.concern (founder_id, created_at DESC);

-- ── 2. concern_message — append-only conversation testimony (founder text is never lost or rewritten) ──
CREATE TABLE IF NOT EXISTS business.concern_message (
  id           TEXT        PRIMARY KEY,
  founder_id   TEXT        NOT NULL,
  concern_id   TEXT        NOT NULL REFERENCES business.concern(id),
  actor        TEXT        NOT NULL,   -- FOUNDER | BUSINESS_BRAIN
  content      TEXT        NOT NULL,
  seq          INTEGER     NOT NULL,   -- ordering within a concern (1-based)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'concern_message_actor_enum') THEN
    ALTER TABLE business.concern_message ADD CONSTRAINT concern_message_actor_enum
      CHECK (actor IN ('FOUNDER','BUSINESS_BRAIN'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_concern_message_seq ON business.concern_message (concern_id, seq);
CREATE INDEX IF NOT EXISTS idx_concern_message_founder ON business.concern_message (founder_id);

CREATE OR REPLACE FUNCTION business.concern_message_forbid_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'concern_message is append-only: UPDATE is forbidden (founder testimony is never rewritten)'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS concern_message_no_update ON business.concern_message;
CREATE TRIGGER concern_message_no_update BEFORE UPDATE ON business.concern_message
  FOR EACH ROW EXECUTE FUNCTION business.concern_message_forbid_update();
CREATE OR REPLACE FUNCTION business.concern_message_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_concern_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'concern_message is append-only: individual DELETE forbidden (only founder-account deletion may remove it)';
  END IF; RETURN OLD;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS concern_message_no_delete ON business.concern_message;
CREATE TRIGGER concern_message_no_delete BEFORE DELETE ON business.concern_message
  FOR EACH ROW EXECUTE FUNCTION business.concern_message_forbid_delete();

-- ── 3. clarity_result — the IMMUTABLE structured clarity assessment for one Business-Brain turn ──
CREATE TABLE IF NOT EXISTS business.clarity_result (
  id                          TEXT        PRIMARY KEY,
  founder_id                  TEXT        NOT NULL,
  concern_id                  TEXT        NOT NULL REFERENCES business.concern(id),
  message_id                  TEXT        REFERENCES business.concern_message(id),
  -- the full validated ClarityResult contract (known/assumed/unknown/conflict/clarified-issue/alternative/next-move/…)
  payload                     JSONB       NOT NULL,
  reflected_concern           TEXT        NOT NULL,
  clarified_issue             TEXT,                          -- null when still unknowable (UNKNOWN is first-class)
  possible_strategic_question TEXT,                          -- null unless a crisp question has plausibly formed
  clarity_schema_version      TEXT        NOT NULL,
  content_hash                TEXT        NOT NULL,          -- SHA-256 over canonical serialization of payload
  seq                         INTEGER     NOT NULL,          -- ordering within the concern (1-based)
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clarity_result_seq ON business.clarity_result (concern_id, seq);
CREATE INDEX IF NOT EXISTS idx_clarity_result_founder ON business.clarity_result (founder_id, created_at DESC);

CREATE OR REPLACE FUNCTION business.clarity_result_forbid_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'clarity_result is append-only: UPDATE is forbidden (a later reading is a new immutable result)'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clarity_result_no_update ON business.clarity_result;
CREATE TRIGGER clarity_result_no_update BEFORE UPDATE ON business.clarity_result
  FOR EACH ROW EXECUTE FUNCTION business.clarity_result_forbid_update();
CREATE OR REPLACE FUNCTION business.clarity_result_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_concern_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'clarity_result is append-only: individual DELETE forbidden (only founder-account deletion may remove it)';
  END IF; RETURN OLD;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clarity_result_no_delete ON business.clarity_result;
CREATE TRIGGER clarity_result_no_delete BEFORE DELETE ON business.clarity_result
  FOR EACH ROW EXECUTE FUNCTION business.clarity_result_forbid_delete();

-- ── 4. proposed_understanding_change — PENDING until the founder explicitly accepts/rejects (the confirmation boundary) ──
CREATE TABLE IF NOT EXISTS business.proposed_understanding_change (
  id                    TEXT        PRIMARY KEY,
  founder_id            TEXT        NOT NULL,
  concern_id            TEXT        NOT NULL REFERENCES business.concern(id),
  clarity_result_id     TEXT        NOT NULL REFERENCES business.clarity_result(id),
  change_type           TEXT        NOT NULL,   -- ADD | CORRECT
  proposed_statement    TEXT        NOT NULL,   -- immutable after creation
  proposed_label        TEXT        NOT NULL,   -- founder-facing truth label the item will carry (immutable after creation)
  explanation           TEXT,
  status                TEXT        NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  resulting_reference   TEXT,                    -- what was created on accept (e.g. a founder-declared understanding item id)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'puc_change_type_enum') THEN
    ALTER TABLE business.proposed_understanding_change ADD CONSTRAINT puc_change_type_enum
      CHECK (change_type IN ('ADD','CORRECT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'puc_status_enum') THEN
    ALTER TABLE business.proposed_understanding_change ADD CONSTRAINT puc_status_enum
      CHECK (status IN ('pending','accepted','rejected'));
  END IF;
  -- The five founder-facing truth labels (rules: no technical jargon; disagreement/unconfirmed is first-class).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'puc_label_enum') THEN
    ALTER TABLE business.proposed_understanding_change ADD CONSTRAINT puc_label_enum
      CHECK (proposed_label IN ('observed_from_material','you_told_me','my_reading','you_corrected_this','unconfirmed_or_disagree'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_puc_founder ON business.proposed_understanding_change (founder_id);
CREATE INDEX IF NOT EXISTS idx_puc_concern_status ON business.proposed_understanding_change (concern_id, status);

-- Content is immutable; only resolution may change, once, one-way (pending -> accepted|rejected). This is the confirmation
-- boundary as a hard invariant: a conversation can PROPOSE, but nothing about the proposal's substance can be silently
-- altered, and an already-resolved proposal can never be reopened or rewritten.
CREATE OR REPLACE FUNCTION business.puc_guard_update() RETURNS trigger AS $$
BEGIN
  IF NEW.proposed_statement <> OLD.proposed_statement
     OR NEW.proposed_label <> OLD.proposed_label
     OR NEW.change_type <> OLD.change_type
     OR NEW.concern_id <> OLD.concern_id
     OR NEW.clarity_result_id <> OLD.clarity_result_id
     OR NEW.founder_id <> OLD.founder_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'proposed_understanding_change: the proposal content is immutable; only its resolution may change';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'proposed_understanding_change: an already-resolved proposal cannot be changed (append a new proposal instead)';
  END IF;
  IF NEW.status NOT IN ('accepted','rejected') THEN
    RAISE EXCEPTION 'proposed_understanding_change: a pending proposal may only move to accepted or rejected';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS puc_no_content_edit ON business.proposed_understanding_change;
CREATE TRIGGER puc_no_content_edit BEFORE UPDATE ON business.proposed_understanding_change
  FOR EACH ROW EXECUTE FUNCTION business.puc_guard_update();
CREATE OR REPLACE FUNCTION business.puc_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_concern_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'proposed_understanding_change: individual DELETE forbidden (only founder-account deletion may remove it)';
  END IF; RETURN OLD;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS puc_no_delete ON business.proposed_understanding_change;
CREATE TRIGGER puc_no_delete BEFORE DELETE ON business.proposed_understanding_change
  FOR EACH ROW EXECUTE FUNCTION business.puc_forbid_delete();

COMMENT ON TABLE business.concern IS 'Clarity/Sensemaking slice — a founder tension/concern head. Sensemaking BEFORE a Strategy Thread; may end with clarity only and never crystallize. Mutable head; testimony/results are append-only.';
COMMENT ON TABLE business.concern_message IS 'Append-only conversation testimony for a concern. Founder text is never rewritten.';
COMMENT ON TABLE business.clarity_result IS 'Immutable structured clarity assessment (known/assumed/unknown/conflict/clarified-issue/alternative/next-move) for one Business-Brain turn. Answers no "you should"; creates no decision.';
COMMENT ON TABLE business.proposed_understanding_change IS 'A Business-Brain-proposed Understanding update that is PENDING until the founder explicitly accepts/rejects. Content immutable; resolution one-way. The confirmation boundary as a DB guarantee.';
