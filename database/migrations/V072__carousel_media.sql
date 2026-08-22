-- V072: Slice 6 — founder-provided media pool. UNSHIPPED (feature/business-brain-v1).
-- Eligible source material (photos / product imagery / logo / brand assets) the founder uploads for Create.
-- Bytes live in the blob store (media_ref); this holds the pool metadata + reuse right. BB CHOOSES which
-- media to use; unused rows are fine. reference_only rows may inform but never render (enforced in domain).

CREATE TABLE IF NOT EXISTS workspace.carousel_media (
  source_ref_id  TEXT        PRIMARY KEY,
  business_id    TEXT        NOT NULL REFERENCES workspace.businesses(id) ON DELETE CASCADE,
  source_type    TEXT        NOT NULL,   -- uploaded_image | brand_asset | ...
  provenance     TEXT        NOT NULL,   -- founder-legible origin
  reuse_right    TEXT        NOT NULL,   -- owned | founder_uploaded | licensed | reference_only | unknown
  media_ref      TEXT        NOT NULL,   -- blob key
  filename       TEXT,
  created_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS carousel_media_biz_idx ON workspace.carousel_media (business_id, created_at DESC);
