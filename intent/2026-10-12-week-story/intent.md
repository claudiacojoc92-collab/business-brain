# Week + Today as a strategist's chapter

**Status:** in-build (deployed 2026-10-12, awaiting prod walk)
**Date:** 2026-10-12 · Operator request

## Intent
The week/today page (arc Moment 6) read like a project manager's brief. Same plan data, told as a chapter:
context line → one big statement → why now (≤ 2 lines) → three numbered beats (verb-first title + one-sentence why)
→ Today as the most prominent card → "Done looks like" → [Draft it with me] · [I'll write it first].
Partner tone, no "Good. We're doing this.", no "THIS WEEK" label, understanding's design language, less card-in-card.

## Decisions
- The week = the plan's first three ACTIONS in order (Today is the first), not the month-level priorities (the old
  "This week" list was really the month). Priorities go to the model as the month's arc, context only.
- Presentation only: a new model (`AnthropicWeekStoryModel`) re-voices; `guardWeekStory` keeps a field only if it has
  no question, no number and no claim term the plan/strategy don't already hold (word families allowed), no generic
  opener, and fits a short cap. A failed field falls back to the plan's own wording for that slot.
- Built once per plan version, persisted as founder_event `arc_week_story_built` (no migration); refresh reuses it.
- Content language from the route's `contentLanguageFor`; UI labels stay English.

## Operator review round 1 (2026-10-12)
- Horizon ("six-month") and priority (audit) contradictions: NOT a product bug. The first demo used the local harness
  business whose SIMULATED founder said "six months" and named the audit. The founder's real prod QuFi strategy
  (01M4QMEVX826PF29NNT76N7GTG) holds horizon "60 days" and bet "make the testnet runnable without your engineers".
- Re-run on a LOCAL COPY of the real prod QuFi (strategy + active founder state + atoms, read-only export): 3/3 runs say
  "60-day", every plan leads with the testnet, no audit, no six months. Output: runs-prod-copy.json.
- Jargon: prompt now carries the strategy's founder-human rules (coffee test, verbs not nouns, people act, no dashes)
  with case-free examples; a phrase check (`jargonIn`) triggers ONE repair pass. Run 1 repaired "work order".
