CREATE TABLE IF NOT EXISTS cycle.content_pieces (
  id                        TEXT        PRIMARY KEY,
  cycle_id                  TEXT        NOT NULL REFERENCES cycle.weekly_cycles(id),
  founder_id                TEXT        NOT NULL,
  brief_id                  TEXT        NOT NULL REFERENCES cycle.internal_briefs(id),
  piece_type                TEXT        NOT NULL,
  piece_role                TEXT        NOT NULL,
  content_blob_key          TEXT,
  content_preview           TEXT,
  approval_status           TEXT        NOT NULL DEFAULT 'AWAITING_APPROVAL',
  approval_window_expires_at TIMESTAMPTZ,
  approved_at               TIMESTAMPTZ,
  rejected_at               TIMESTAMPTZ,
  rejection_reason_code     TEXT,
  published_at              TIMESTAMPTZ,
  platform_post_id          TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_pieces_cycle_idx
  ON cycle.content_pieces (cycle_id);

CREATE INDEX IF NOT EXISTS content_pieces_founder_approval_idx
  ON cycle.content_pieces (founder_id, approval_status)
  WHERE approval_status = 'AWAITING_APPROVAL';
