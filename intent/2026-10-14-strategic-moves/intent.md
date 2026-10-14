# Intent: Strategic Moves (search-verified moves the founder couldn't produce alone)

- **Status:** in-build
- **Requested by:** operator, 2026-10-14 (design agreed in session; see decisions below)

## Problem
BB reads only the founder's own sources (website, Instagram, PDFs, pasted text), so every output is derived from what
the founder already has: a mirror, not a strategist. Founder feedback: "correct but not wow; it doesn't give me moves I
wouldn't have thought of." A manual test with search (2026-10-14) showed search is necessary but not sufficient: the
strongest move (Start-Up Nation) was rejected as "already knew it".

## What we build (2 weeks, code only, no operator gating)
A Moves surface: named organisations + specific ask + "why now" when a dated source exists, every fact quoted from a
fetched page. Model knowledge generates candidates (internal only); search verifies them.

## Decisions (operator, 2026-10-14)
- Model-knowledge candidates are never shown; only facts quoted from **fetched pages** reach the founder. Snippets never count.
- No fallback to model-only candidates: an unverifiable candidate is dropped; all dropped → honest "nothing new" state.
- "BB's read" lane only for partner motives, chip "our read, not sourced". Never numbers, never outcomes.
- 3-field capture at the Moves entry (not before Understanding, not in the arc): known organisations, what hurts
  (specific chips), what you want (partners / clients / visibility). Pre-filled from founder state; editable; skippable.
- Stored in the existing `workspace.founder_state` (no new store, no migration): budget/time chips → `resource`
  (`pain:*`), other chips → `intention` (`pain:*`), wants → `intention` (`want:*`), known orgs → `resource`
  (`known_org`), taste → `preference` (`avoid:*`). Strategy gates skip the Moves scopes.
- Pain chips are specific ("No budget for paid ads"), and must not block non-cash moves (revenue share, barter, free listing).
- Runs stored in `founder_event` metadata (v1, no migration).
- External pages: evidence with `source='external_web'`, never linked to the business; never in understanding or
  strategy cards; shown only in the Moves card "Why this" (URL + quote, opens the outside page).
- Obviousness filter (top-5 plain search for the need → dropped) and novelty gate (≥1 external source per move).
- Restatements are hidden from the founder; kept in the run record with the reason.
- Not built: weak points screen, point-by-point actions, Talk to BB as a strategy engine.
- SDK upgrade is its own commit before the search adapter.
