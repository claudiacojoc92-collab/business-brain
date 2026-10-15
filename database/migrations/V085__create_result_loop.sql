-- RESULT LOOP V1 (intent/2026-10-14-result-loop). The minimum durable state to close ONE acquisition loop:
-- STRATEGY → CONTACT → OUTREACH → FOLLOW-UP → OUTCOME → IMPACT → NEXT MOVE. Not a CRM, not a workflow engine.
--
--   contact        the organisation or person a strategy works through (current state: details + status)
--   touch          APPEND-ONLY: every email sent, visit, call, reply, note (what actually happened, and who said so)
--   outcome        APPEND-ONLY: the typed result of a touch (NO_RESPONSE … REFERRAL_RECEIVED), with the founder's
--                  original words as evidence. An outcome is never founder_state (never a constraint / correction).
--   follow_up      a contact-level obligation (what is due, when, why). Survives plan regeneration. Its status
--                  resolves once (OPEN → DONE | RESCHEDULED | CANCELLED); a reschedule is a NEW row that points at the
--                  one it replaces, so what was originally due and what actually happened both stay readable.
--   writing_entry  APPEND-ONLY evidence of how the founder writes (samples, explicit corrections, accepted / rejected
--                  wording, preferences, the confirmed sender) and RELEVANCE: her correction of which offer parts a
--                  message to one contact focuses on. Never inferred personality. The profile is a projection.
--
-- Conventions (V077+): plain business_id, no FKs to workspace tables. UPDATE is refused on the append-only tables by
-- trigger; DELETE stays possible so a per-business reset can clear them. Additive + idempotent.

CREATE SCHEMA IF NOT EXISTS result;

CREATE TABLE IF NOT EXISTS result.contact (
  id                 text        PRIMARY KEY,
  business_id        text        NOT NULL,
  type               text        NOT NULL CHECK (type IN ('ORGANISATION', 'PERSON')),
  name               text        NOT NULL,
  organisation_name  text        NULL,
  role               text        NULL,            -- role / specialty ("ortoped", "clinic manager")
  email              text        NULL,
  phone              text        NULL,
  website            text        NULL,
  source             jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- {kind: founder|report|research, quote?, url?}
  status             text        NOT NULL DEFAULT 'TARGET'
                     CHECK (status IN ('TARGET', 'CONTACTED', 'IN_CONVERSATION', 'PARTNER', 'NOT_INTERESTED', 'NEEDS_DETAILS')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_result_contact_business ON result.contact (business_id, created_at);

CREATE TABLE IF NOT EXISTS result.touch (
  id            text        PRIMARY KEY,
  business_id   text        NOT NULL,
  contact_id    text        NOT NULL,
  action_ref    text        NULL,                -- plan action id / follow-up id / message id that this touch executed
  channel       text        NOT NULL CHECK (channel IN ('EMAIL', 'PHONE', 'WHATSAPP', 'VISIT', 'OTHER')),
  direction     text        NOT NULL CHECK (direction IN ('OUTBOUND', 'INBOUND')),
  type          text        NOT NULL CHECK (type IN ('SENT', 'VISITED', 'REPLIED', 'FOLLOW_UP', 'NOTE')),
  occurred_at   timestamptz NOT NULL,
  summary       text        NOT NULL,
  source        jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- {kind: message|report|founder, statement?, quote?, messageId?}
  created_by    text        NOT NULL CHECK (created_by IN ('BB', 'FOUNDER', 'SYSTEM')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_result_touch_contact ON result.touch (business_id, contact_id, occurred_at);

CREATE TABLE IF NOT EXISTS result.outcome (
  id            text        PRIMARY KEY,
  business_id   text        NOT NULL,
  contact_id    text        NOT NULL,
  touch_id      text        NULL,
  outcome_type  text        NOT NULL CHECK (outcome_type IN ('NO_RESPONSE', 'NOT_INTERESTED', 'MATERIAL_REQUESTED',
                              'FOLLOW_UP_REQUESTED', 'MEETING_REQUESTED', 'REFERRAL_RECEIVED', 'CONVERTED', 'OTHER')),
  stage         text        NULL,
  occurred_at   timestamptz NOT NULL,
  note          text        NOT NULL DEFAULT '',
  evidence      jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- {statement (founder's original words), quote, editedByFounder?}
  created_by    text        NOT NULL CHECK (created_by IN ('BB', 'FOUNDER', 'SYSTEM')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_result_outcome_business ON result.outcome (business_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_result_outcome_contact ON result.outcome (business_id, contact_id, occurred_at);

CREATE TABLE IF NOT EXISTS result.follow_up (
  id                    text        PRIMARY KEY,
  business_id           text        NOT NULL,
  contact_id            text        NOT NULL,
  what                  text        NOT NULL,
  reason                text        NOT NULL DEFAULT '',
  due_on                date        NOT NULL,
  status                text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'RESCHEDULED', 'CANCELLED')),
  created_from          text        NULL,     -- the outcome / touch id that created this obligation
  replaces_id           text        NULL,     -- the follow-up this one reschedules
  resolved_by_touch_id  text        NULL,
  resolved_at           timestamptz NULL,
  created_by            text        NOT NULL CHECK (created_by IN ('BB', 'FOUNDER', 'SYSTEM')),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_result_follow_up_due ON result.follow_up (business_id, status, due_on);

CREATE TABLE IF NOT EXISTS result.writing_entry (
  id            text        PRIMARY KEY,
  business_id   text        NOT NULL,
  kind          text        NOT NULL CHECK (kind IN ('SENDER', 'SAMPLE', 'ACCEPTED_PHRASE', 'REJECTED_PHRASE', 'NEVER_SAY', 'PREFERENCE', 'RELEVANCE')),
  key           text        NULL,          -- PREFERENCE: greeting | signoff | length | directness | warmth; RELEVANCE: contact id
  text          text        NOT NULL,      -- the value / phrase / sample / sender JSON
  evidence      jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- where it came from: {kind: explicit|edit|sample, ref?, before?, after?}
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_result_writing_business ON result.writing_entry (business_id, created_at);

-- Append-only: UPDATE is refused on history tables (DELETE stays possible for a per-business reset).
CREATE OR REPLACE FUNCTION result.refuse_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'result.% is append-only', TG_TABLE_NAME;
END;
$$;
DROP TRIGGER IF EXISTS touch_append_only ON result.touch;
CREATE TRIGGER touch_append_only BEFORE UPDATE ON result.touch FOR EACH ROW EXECUTE FUNCTION result.refuse_update();
DROP TRIGGER IF EXISTS outcome_append_only ON result.outcome;
CREATE TRIGGER outcome_append_only BEFORE UPDATE ON result.outcome FOR EACH ROW EXECUTE FUNCTION result.refuse_update();
DROP TRIGGER IF EXISTS writing_append_only ON result.writing_entry;
CREATE TRIGGER writing_append_only BEFORE UPDATE ON result.writing_entry FOR EACH ROW EXECUTE FUNCTION result.refuse_update();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bbapp') THEN
    GRANT USAGE ON SCHEMA result TO bbapp;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA result TO bbapp;
  END IF;
END;
$$;
