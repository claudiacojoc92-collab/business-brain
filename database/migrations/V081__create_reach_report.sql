-- ATTRIBUTION BY ASKING. A founder-led service business cannot attribute technically (analytics is useless at
-- that scale), but the owner can ask one question at the door: "how did you hear about us?". This table holds
-- the founder's own weekly answer — how many new people came, and how they heard — as REFLECTIVE, founder-owned
-- data. Their report, their data: they can correct or delete any entry.
--
-- REFLECTIVE-ONLY — HARD WALL. This data is NEVER a licensed proposition and MUST NOT reach any asset generator
-- (carousel / reel / voice). "You told me 3 of the 7 new people came from Instagram" is sayable BACK TO THE
-- FOUNDER as their own words; "the reel brought 3 people" is a causal claim BB never makes. The wall is enforced
-- in code (composition WALL-START/WALL-END markers) and by the asset-authority wall test; this store sits
-- deliberately outside the claim-authority graph.
--
-- NOT WIRED to the impact evaluator yet (by decision — store + reflect only). The shape is the shape the
-- evaluator's existing `outcome_report` source consumes (verbatim text + window + published link), so the later
-- connection is a thin call and needs no schema change. Additive + idempotent (safe to re-run).
--
-- NO FOREIGN KEYS, by convention. The most recent workspace tables — reels (V077), shoot (V078) and proof_fact
-- (V080, the table this one is modeled on) — all use a plain `business_id text NOT NULL` with no FK (the older
-- slice-root tables V066–V070 used `REFERENCES workspace.businesses(id) ON DELETE CASCADE`; V077+ dropped it).
-- reach_report follows the current V080 convention exactly rather than reintroducing the older one.

CREATE TABLE IF NOT EXISTS workspace.reach_report (
  id                text        PRIMARY KEY,
  business_id       text        NOT NULL,          -- per-business workspace scope (NOT founder-cycle legacy)
  account_id        text        NOT NULL,          -- the founder who reported
  week_start        date        NOT NULL,          -- Monday of the ISO week this answer covers
  week_end          date        NOT NULL,          -- the next Monday (exclusive window end)
  new_people_count  integer     NULL,              -- how many new people came, if the founder gave a number
  raw_text          text        NOT NULL,          -- the founder's OWN WORDS, verbatim — how the new people heard
  channel_hint      text        NULL,              -- optional light single-tag structure (never required)
  published_refs    jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- what BB published in the window (founder_event refs)
  reported_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Cheap integrity: a window cannot end before it starts; a head count cannot be negative.
  CONSTRAINT reach_report_window_ordered CHECK (week_start <= week_end),
  CONSTRAINT reach_report_count_nonneg   CHECK (new_people_count IS NULL OR new_people_count >= 0)
);

-- ONE report per business per week is the model — corrections go through PATCH, not a second row. The app-level
-- weekly gate (founder_event) can fail (a double-click, a retry after a timeout, an ISO-week bug); this UNIQUE
-- index is the DATABASE making it true regardless, so the reflective view can never double-count and tell the
-- founder something false about his own business. The writer upserts on this key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reach_report_week ON workspace.reach_report (business_id, week_start);
CREATE INDEX IF NOT EXISTS idx_reach_report_business ON workspace.reach_report (business_id, reported_at DESC);
