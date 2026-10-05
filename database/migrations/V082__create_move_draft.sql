-- V082 — MoveDraft: a produced artifact attached to a plan move (landing-page copy first).
-- Append-only: an edit or regeneration writes a NEW row (higher version); the latest per (business, action)
-- wins. The draft lives BESIDE the immutable move (never on plan_version.priorities). The authorization
-- snapshot + safety decision are stored immutably for audit replay, exactly as the carousel asset does.
-- See intent/2026-10-05-landing-move.

CREATE TABLE IF NOT EXISTS workspace.move_draft (
  move_draft_id    TEXT        NOT NULL PRIMARY KEY,
  business_id      TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  action_id        TEXT        NOT NULL,                                        -- the move this draft fulfils
  plan_version_id  TEXT        NOT NULL REFERENCES workspace.plan_version(plan_version_id) ON DELETE CASCADE,
  kind             TEXT        NOT NULL,                                        -- 'landing' (extensible)
  language         TEXT        NOT NULL,
  draft            JSONB,                                                       -- NULL only when status='blocked' (fail-closed)
  snapshot         JSONB       NOT NULL,                                        -- immutable LandingAuthorizationSnapshot
  safety_decision  JSONB       NOT NULL,                                        -- the gate's SafetyDecision trace
  status           TEXT        NOT NULL,                                        -- drafted | edited | accepted | blocked
  version          INTEGER     NOT NULL,                                        -- append-only; bumps per edit/regeneration
  produced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- latestForAction: newest version for a given move.
CREATE INDEX IF NOT EXISTS move_draft_action_idx ON workspace.move_draft (business_id, action_id, version DESC, produced_at DESC);
