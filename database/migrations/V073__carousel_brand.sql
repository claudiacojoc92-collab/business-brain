-- V073: Slice 6 — per-business BrandContext for the canonical carousel template. UNSHIPPED (feature branch).
-- The FROZEN CanonicalCarouselTemplate v1 geometry never changes; these grounded brand tokens (palette,
-- logo, typography/imagery preferences, explicit don'ts) tint it per client. Discovered/grounded only —
-- absent → the restrained neutral fallback. One row per business (upsert).

CREATE TABLE IF NOT EXISTS workspace.carousel_brand (
  business_id      TEXT        PRIMARY KEY REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  palette          JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [bg, ink, muted, accent, ...]
  logo_ref         TEXT,
  type_preference  TEXT,
  imagery_style    TEXT,
  explicit_donts   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  source           TEXT        NOT NULL,                       -- how it was grounded (website | founder | assets)
  updated_at       TIMESTAMPTZ NOT NULL
);
