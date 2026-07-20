-- V065: Entity edit-after-create (Wave 3 final hardening). When a founder changes an entity's WEBSITE, the
-- prior reviews + findings must remain auditable but must NOT be treated as current context for the new site.
-- `website_changed_at` records the last website change; effective orchestration excludes findings from any
-- review created before this timestamp (a review that ran against the OLD website), until a fresh successful
-- review of the new website exists. NULL = the website has never changed (all successful reviews are current).

ALTER TABLE business.market_entity ADD COLUMN IF NOT EXISTS website_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN business.market_entity.website_changed_at IS
  'Wave 3: last time the website was edited; findings from reviews predating it are stale (old site) and excluded from current orchestration until a fresh review runs.';
