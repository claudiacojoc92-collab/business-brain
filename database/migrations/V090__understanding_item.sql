-- V090: Founder-governed Understanding items — the durable, reusable consequence of accepting a clarity proposal (and of a
-- founder correction). This closes the accumulation loop: an accepted proposal becomes part of the EFFECTIVE current
-- Understanding, is founder-attributed with a truth label, appears in the founder-facing surface, is retrieved by later
-- clarity sessions, and can be corrected/superseded WITHOUT rewriting history.
--
-- Design: additive and APPEND-ONLY. Rather than force founder-governed items into the website-synthesis `understanding`
-- versioning (V058) — which would mix them with synthesized conclusions and mutate versions — a dedicated table holds them.
-- The EFFECTIVE understanding is composed at read time = synthesized conclusions (minus any a founder correction supersedes)
-- + current founder-governed items (those no later item supersedes). "Current" is DERIVED from supersession links, so no row
-- is ever updated: a correction/supersession is a NEW row referencing the one it replaces. History and authorship are kept.
--
-- Acceptance is transactional at the service layer: the item insert and the proposal resolution succeed together or neither
-- does (a proposal is never marked accepted while its Understanding write fails). Founder-scoped throughout. Forward-only.

CREATE TABLE IF NOT EXISTS business.understanding_item (
  id                        TEXT        PRIMARY KEY,
  founder_id                TEXT        NOT NULL,
  statement                 TEXT        NOT NULL,             -- plain-language, founder-facing
  truth_label               TEXT        NOT NULL,             -- one of the five founder-facing labels
  origin                    TEXT        NOT NULL,             -- clarity_acceptance | founder_correction
  supersedes_item_id        TEXT        REFERENCES business.understanding_item(id), -- the item this replaces (null = original)
  resolves_unknown_ref      TEXT,                             -- a synthesized unknown this genuinely resolves (else null)
  origin_conclusion_ref     TEXT,                             -- a synthesized conclusion this corrects (case B), else null
  -- clarity lineage (where a clarity_acceptance item came from) — durable identifiers, immutable
  origin_concern_id         TEXT,
  origin_clarity_result_id  TEXT,
  origin_proposed_change_id TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ui_truth_label_enum') THEN
    ALTER TABLE business.understanding_item ADD CONSTRAINT ui_truth_label_enum
      CHECK (truth_label IN ('observed_from_material','you_told_me','my_reading','you_corrected_this','unconfirmed_or_disagree'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ui_origin_enum') THEN
    ALTER TABLE business.understanding_item ADD CONSTRAINT ui_origin_enum
      CHECK (origin IN ('clarity_acceptance','founder_correction'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_understanding_item_founder ON business.understanding_item (founder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_understanding_item_supersedes ON business.understanding_item (supersedes_item_id);
-- at most one direct successor per item — a linear supersession chain, no forks
CREATE UNIQUE INDEX IF NOT EXISTS uniq_understanding_item_supersedes ON business.understanding_item (supersedes_item_id) WHERE supersedes_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION business.understanding_item_forbid_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'understanding_item is append-only: UPDATE is forbidden (a correction is a new item that supersedes this one)'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS understanding_item_no_update ON business.understanding_item;
CREATE TRIGGER understanding_item_no_update BEFORE UPDATE ON business.understanding_item
  FOR EACH ROW EXECUTE FUNCTION business.understanding_item_forbid_update();
CREATE OR REPLACE FUNCTION business.understanding_item_forbid_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('bb.allow_understanding_item_delete', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'understanding_item is append-only: individual DELETE forbidden (only founder-account deletion may remove it)';
  END IF; RETURN OLD;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS understanding_item_no_delete ON business.understanding_item;
CREATE TRIGGER understanding_item_no_delete BEFORE DELETE ON business.understanding_item
  FOR EACH ROW EXECUTE FUNCTION business.understanding_item_forbid_delete();

-- Bidirectional link: the proposal records exactly which Understanding item its acceptance produced (item -> proposal via
-- origin_proposed_change_id above; proposal -> item here). Set during the transactional accept; the V089 guard already
-- permits this column to change while status moves pending -> accepted.
ALTER TABLE business.proposed_understanding_change
  ADD COLUMN IF NOT EXISTS resulting_understanding_item_id TEXT REFERENCES business.understanding_item(id);

COMMENT ON TABLE business.understanding_item IS 'Founder-governed Understanding items (clarity acceptances + founder corrections). Append-only; effective = not-superseded. Composed with synthesized conclusions into the effective current Understanding. History + authorship preserved; acceptance is transactional.';
