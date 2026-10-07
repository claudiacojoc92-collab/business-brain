-- V083 — LICENSED ATOMS. A business's verifiable OPERATIONAL ATOMS (service names, addresses, contact/booking,
-- named people with roles) extracted from its OWN ingested page text and licensed as `business_evidence` facts
-- the business may state about itself. Sibling to proof_fact (V080): same provenance discipline, but the ONLY
-- safety mechanism is VERBATIM ANCHORING — each atom carries the exact source span (source_url + char offsets)
-- so unit.text.slice(char_start, char_end) === value, and "where did this fact come from" is answerable from
-- the DB alone, without re-running extraction. Language-neutral by construction (no regex, no language gate).
--
-- Closed scope: atom_class is one of service|location|contact_booking|people (schedule/price deferred, additive
-- later with no schema change — a new enum value, not a new column). Append-and-replace per business, keyed by
-- source_fingerprint (the bound-fragment set at extraction time), exactly like proof_fact.

CREATE TABLE IF NOT EXISTS workspace.business_atom (
  id                 text        PRIMARY KEY,
  business_id        text        NOT NULL,
  atom_class         text        NOT NULL,          -- service|location|contact_booking|people
  value              text        NOT NULL,          -- the EXACT verbatim span licensed, as written (diacritics/newlines preserved)
  source_ref         text        NOT NULL,          -- founder-readable page/source label
  source_url         text        NOT NULL,          -- resolvable provenance (NOT NULL — no atom without a source)
  char_start         integer     NOT NULL,          -- offsets into the cited unit's text: slice(char_start,char_end) === value
  char_end           integer     NOT NULL,
  source_fingerprint text        NOT NULL,          -- hash of the bound-fragment set at extraction time (cache/staleness key)
  model_id           text        NULL,              -- the proposer model; the LICENSING decision is deterministic, not the model's
  extracted_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_atom_business ON workspace.business_atom (business_id, extracted_at);
CREATE INDEX IF NOT EXISTS idx_business_atom_fingerprint ON workspace.business_atom (business_id, source_fingerprint);
