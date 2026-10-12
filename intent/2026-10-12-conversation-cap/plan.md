# Plan: conversation cap + no questions on understanding corrections (BUS-65)

- Spec (operator, 2026-10-12): turns 1–3 questions; turn 4 one-click goal confirm (or ASSUMED goal from the
  constraint, flagged); no 5th question. Option A: correcting the understanding never asks a question.
- Evidence: runs.md (service-level), runs-real-routes.md (real api + DB + models, the founder's path).

## Status log
- 2026-10-12: done — cap/goal confirm/assumed goal/scroll deployed (96b1711, PR #16; api 2d3a66ae, web 3c6a3ded);
  root cause of the QuFi loop = understanding corrections (6× arc_correction_reflected, no conversation session);
  Option A + mirror-skip race + no re-open after confirm built and walked through the real routes, UNCOMMITTED /
  next — browser check of the correction card, commit, merge, deploy api+web, QuFi prod walk / blockers —
  approve commit approve deploy (BUS-65)
- 2026-10-12: done — Option A shipped (fe171a1, PR #17 merged e8bfc89; api 43914911, web 2dc5b161; clean worktree 2050 tests) / next —
  QuFi prod walk (no question on old corrections → Let's start → 3 questions → goal confirm → strategy) / blockers — none (BUS-65)
