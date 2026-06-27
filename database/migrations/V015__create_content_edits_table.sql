CREATE TABLE IF NOT EXISTS cycle.content_edits (
  id                    TEXT        PRIMARY KEY,
  content_piece_id      TEXT        NOT NULL REFERENCES cycle.content_pieces(id),
  cycle_id              TEXT        NOT NULL,
  founder_id            TEXT        NOT NULL,
  edit_type             TEXT        NOT NULL,
  original_fragment     TEXT        NOT NULL,
  replacement_fragment  TEXT        NOT NULL,
  edit_position         INTEGER,
  edited_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_edits_piece_idx
  ON cycle.content_edits (content_piece_id);
