-- V053: Recommendation — the first Product Primitive under ADR-010, persisted at Layer 2.
--
-- A Recommendation IS an `inferred` claim (Layer 1, in evidence.fragments — its truth status is
-- preserved there, untouched). This table stores the Layer-2 PRODUCT PRIMITIVE: the behavioral
-- disclosure contract (evidence basis, assumptions, confidence, founder-facing language) that the
-- inferred claim is wrapped in to be emitted. Both are preserved: the inferred fragment (truth) and
-- this row (the product contract that references it). Layer 1 is not modified.
--
-- The DB constraints re-assert the fail-closed contract (belt to the emitRecommendation suspenders):
-- basis and assumptions must be non-empty; confidence and language are NOT NULL.

CREATE TABLE IF NOT EXISTS memory.recommendations (
  founder_id          TEXT        NOT NULL,
  claim_fragment_id   TEXT        NOT NULL,                 -- the Layer-1 `inferred` fragment (truth status lives there)
  thread_signature    TEXT,                                 -- the thread it is about (nullable)
  evidence_basis      JSONB       NOT NULL,                 -- (a) real evidence ids ⊆ the claim's derived_from
  assumptions         JSONB       NOT NULL,                 -- (b) external patterns disclosed (never asserted as fact)
  confidence          TEXT        NOT NULL
                        CHECK (confidence IN ('low','medium','high')),  -- (c) Layer-2 disclosure, not an epistemic kind
  recommendation_text TEXT        NOT NULL,                 -- (d) founder-facing "what I'd do", rendered as a read
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (founder_id, claim_fragment_id),              -- one recommendation per inferred claim per founder
  -- Contract is fail-closed at the storage edge too: disclosure can never be empty.
  CONSTRAINT rec_basis_nonempty
    CHECK (jsonb_typeof(evidence_basis) = 'array' AND jsonb_array_length(evidence_basis) > 0),
  CONSTRAINT rec_assumptions_nonempty
    CHECK (jsonb_typeof(assumptions) = 'array' AND jsonb_array_length(assumptions) > 0)
);

CREATE INDEX IF NOT EXISTS idx_recommendations_founder ON memory.recommendations (founder_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_thread  ON memory.recommendations (founder_id, thread_signature);

-- Thread history can reference Recommendations exactly like other founder interactions: add a
-- 'recommended' event kind (additive — existing kinds unchanged; a 'recommended' event carries no
-- reason, consistent with the resolved-iff-reason constraint). tension_id on the event = the
-- recommendation's claim id, linking the thread's history to the primitive.
ALTER TABLE memory.thread_events DROP CONSTRAINT IF EXISTS thread_events_event_check;
ALTER TABLE memory.thread_events ADD CONSTRAINT thread_events_event_check
  CHECK (event IN ('opened','recurred','addressed','resolved','recommended'));

COMMENT ON TABLE memory.recommendations IS
  'ADR-010 Recommendation primitive (Layer 2): the disclosure contract (basis/assumptions/confidence/language) wrapping an inferred claim. The claim''s inferred truth status is preserved in evidence.fragments; this row references it.';
