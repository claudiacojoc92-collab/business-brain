# Plan: week story

1. Contracts + pure guard (`arc/week-story.ts`) + tests — done
2. Model + composition wiring + founder_event persistence — done
3. Web: `WeekStory` component + CSS — done
4. Live on local QuFi (real routes, real model) + browser desktop/mobile — done
5. Operator review → commit/PR/merge → deploy api + web → prod check on a founder reaching Moment 6

## Status log
- 2026-10-12: done — built + local QuFi live + browser desktop/mobile; full suite 2063 green / next — operator review,
  then ship (needs approve commit + approve deploy) / blockers — operator review
- 2026-10-12: done — review round 1: horizon/priority traced to the harness persona (prod strategy is 60 days +
  testnet); 3/3 runs on a prod copy stable; founder-human voice + jargon repair; suite 2065 green / next — operator
  approval, then ship / blockers — operator review (BUS-67)
- 2026-10-12: done — shipped cf8512b (PR #18 merged ec1a26c; api c5aba5c1, web 711cbc43; clean worktree 2065 tests) / next —
  operator walks QuFi in prod (60 days, testnet first, no jargon, no dashes) / blockers — none (BUS-67)
- 2026-10-12: done — email voice fix (no dashes, no '+' subject joiner, simple placeholders, active voice) via shared spoken-voice cleanup; cross-surface voice = BUS-68 / next — deploy, operator redrafts the QuFi email (Draft again) then continues to the container / blockers — none
- 2026-10-12: done — operator found (a) no 'Draft again' button: it is 'Revise it' (regenerates; my wrong name) → renamed 'Draft it again', export label without dash; (b) fresh draft claimed 'a confirmed testnet date' → email-claims gate (present claims only) + 1 repair + soften; (c) found + fixed: the shipped dash cleanup collapsed '- ' bullet lists into commas. 3/3 drafts on real QuFi inputs clean; suite 2072 / next — operator reviews drafts, then ship (approve commit + approve deploy) / blockers — operator review
- 2026-10-12: done — QuFi walk batch (9 items, local, NOT deployed): one voice (VOICE_RULES in 7 prompts + spokenView at the arc exit + Today/home + EN UI strings), Today whole sentences via week story, container 'You told me' lane (judged + guarded), held goal = outcome or founder-confirmed, mirror drops site-path gaps + question-as-evidence, pinned pour-in CTA, mirror skip is a button, Open in Gmail, colon before list, no content truncation (uncut content events). 5 full local QuFi flows on her real inputs; final run clean on all 11 surfaces; suite 2081 / next — operator reviews, then ship / blockers — operator review
