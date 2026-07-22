-- V092: Founder Validation Readiness — make the CURRENT product safe, observable, and practical for a small invited pilot.
-- NO new strategic capability. A separate `pilot` schema holds invite/access/consent, research instrumentation, optional
-- founder feedback, reality markers, facilitator annotations, and willingness-to-pay interview records — all cleanly
-- separable from (and deletable independently of) the founder's business data. Research annotations live here; they NEVER
-- enter Business Understanding or the AI context, and they never alter immutable clarity results.
--
-- Privacy: research_event payloads carry metadata + entity ids ONLY (no raw business/concern text). facilitator_note and
-- wtp_record are append-only. On founder deletion, personal/business pilot rows are deleted and research_event is anonymized
-- (founder_id nulled, aggregate event kept) — the strongest feasible deletion while preserving anonymous aggregate signal.
-- Forward-only.

CREATE SCHEMA IF NOT EXISTS pilot;

-- ── invites ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pilot.invite (
  code          TEXT        PRIMARY KEY,
  cohort        TEXT        NOT NULL DEFAULT 'pilot-1',
  status        TEXT        NOT NULL DEFAULT 'invited',  -- invited | activated | disabled
  founder_id    TEXT,                                    -- set on activation
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at  TIMESTAMPTZ,
  disabled_at   TIMESTAMPTZ
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invite_status_enum') THEN
    ALTER TABLE pilot.invite ADD CONSTRAINT invite_status_enum CHECK (status IN ('invited','activated','disabled'));
  END IF;
END $$;

-- ── pilot founder: access + consent + minimal setup identity (one active business per founder in V1) ──
CREATE TABLE IF NOT EXISTS pilot.pilot_founder (
  founder_id              TEXT        PRIMARY KEY,
  invite_code             TEXT        REFERENCES pilot.invite(code),
  cohort                  TEXT        NOT NULL DEFAULT 'pilot-1',
  access_status           TEXT        NOT NULL DEFAULT 'active',  -- active | disabled (admin can disable WITHOUT deleting data)
  consent_pilot           BOOLEAN     NOT NULL DEFAULT false,     -- accepted the pilot agreement
  consent_research_review BOOLEAN     NOT NULL DEFAULT false,     -- explicit opt-in for human review of conversations
  business_name           TEXT,
  stage                   TEXT,
  setup_completed         BOOLEAN     NOT NULL DEFAULT false,
  wtp_open                BOOLEAN     NOT NULL DEFAULT false,     -- admin opens the pilot-completion WTP prompt
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pilot_founder_access_enum') THEN
    ALTER TABLE pilot.pilot_founder ADD CONSTRAINT pilot_founder_access_enum CHECK (access_status IN ('active','disabled'));
  END IF;
END $$;

-- ── append-only research events (metadata + entity ids ONLY — never raw sensitive content) ──
CREATE TABLE IF NOT EXISTS pilot.research_event (
  id          TEXT        PRIMARY KEY,
  founder_id  TEXT,                                     -- nullable → anonymized on deletion
  cohort      TEXT,
  event_type  TEXT        NOT NULL,
  entity_id   TEXT,
  metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_event_founder ON pilot.research_event (founder_id, created_at);
CREATE INDEX IF NOT EXISTS idx_research_event_type ON pilot.research_event (event_type, created_at);
CREATE OR REPLACE FUNCTION pilot.research_event_forbid_update() RETURNS trigger AS $$
BEGIN
  -- allow ONLY founder_id anonymization (founder_id → NULL) on deletion; forbid all other edits
  IF NEW.event_type <> OLD.event_type OR NEW.metadata <> OLD.metadata OR NEW.created_at <> OLD.created_at OR NEW.entity_id IS DISTINCT FROM OLD.entity_id THEN
    RAISE EXCEPTION 'research_event is append-only (only founder_id anonymization is permitted)';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS research_event_no_update ON pilot.research_event;
CREATE TRIGGER research_event_no_update BEFORE UPDATE ON pilot.research_event FOR EACH ROW EXECUTE FUNCTION pilot.research_event_forbid_update();

-- ── concern reality marker (research metadata; upsert = idempotent, one per concern) ──
CREATE TABLE IF NOT EXISTS pilot.concern_reality (
  founder_id  TEXT        NOT NULL,
  concern_id  TEXT        NOT NULL,
  marker      TEXT        NOT NULL,   -- yes_now | yes_not_urgent | exploratory
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (founder_id, concern_id)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'concern_reality_marker_enum') THEN
    ALTER TABLE pilot.concern_reality ADD CONSTRAINT concern_reality_marker_enum CHECK (marker IN ('yes_now','yes_not_urgent','exploratory'));
  END IF;
END $$;

-- ── optional founder feedback after a meaningful clarity result (upsert = idempotent, one per concern) ──
CREATE TABLE IF NOT EXISTS pilot.concern_feedback (
  founder_id          TEXT        NOT NULL,
  concern_id          TEXT        NOT NULL,
  clarity_result_id   TEXT,
  clearer             TEXT,        -- yes | somewhat | no
  changed_attention   TEXT,        -- yes | no | not_sure
  reached_alone       TEXT,        -- probably | maybe | probably_not
  useful_text         TEXT,
  normal_alternative  TEXT,        -- think_alone | notes | cofounder | consultant | generic_ai | other
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (founder_id, concern_id)
);

-- ── facilitator annotations (research ONLY — never AI context) ──
CREATE TABLE IF NOT EXISTS pilot.facilitator_note (
  id          TEXT        PRIMARY KEY,
  founder_id  TEXT        NOT NULL,   -- the subject founder
  concern_id  TEXT,
  author      TEXT        NOT NULL,   -- facilitator/admin identifier
  note        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facilitator_note_founder ON pilot.facilitator_note (founder_id);

-- ── willingness-to-pay interview record (research evidence, NOT validated revenue) ──
CREATE TABLE IF NOT EXISTS pilot.wtp_record (
  id              TEXT        PRIMARY KEY,
  founder_id      TEXT        NOT NULL,
  would_continue  BOOLEAN,
  would_miss      TEXT,
  would_pay       BOOLEAN,
  amount          NUMERIC,
  price_band      TEXT,
  basis           TEXT,        -- monthly | per_session | program | would_not_pay
  recorded_by     TEXT,        -- 'founder' | admin id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wtp_founder ON pilot.wtp_record (founder_id);

COMMENT ON SCHEMA pilot IS 'Founder Validation Readiness — invite/access/consent, research instrumentation, feedback, reality markers, facilitator notes, WTP interviews. Research annotations only; never enters Business Understanding or AI context; never alters immutable clarity results. Deletable independently of business data.';
