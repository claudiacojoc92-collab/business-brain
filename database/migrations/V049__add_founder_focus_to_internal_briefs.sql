-- V049: Founder Voice v1 — add nullable founder_focus to committed briefs.
--
-- Holds ONE founder-facing "leverage reveal" sentence produced by S11 (PR-009) on the
-- main path. Nullable by design: fallback briefs (S11F/PR-011) and all existing committed
-- cycles carry NULL (honest silence — no sentence is fabricated when none was generated).

ALTER TABLE cycle.internal_briefs
  ADD COLUMN IF NOT EXISTS founder_focus TEXT;

COMMENT ON COLUMN cycle.internal_briefs.founder_focus IS
  'Founder-facing one-sentence leverage reveal (PR-009 founder_focus). NULL for fallback briefs and pre-feature cycles.';
