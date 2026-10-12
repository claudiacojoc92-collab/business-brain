# Plan: Strategic Depth — Week 1 (constraint + stage)

- **Intent:** ./intent.md
- **Approved by:** operator brief 2026-10-12 (scope + decisions recorded in intent.md)

## Approach
The model already writes the contradictions; it now also writes ONE `constraint` (the cause behind them) and a `stage`
with cited evidence, inside the same synthesis call (no extra call, no migration: understanding is JSONB). Gates are
deterministic in the arc projection: a gated or empty constraint shows as an honest "not enough evidence", a stage
needs ≥2 gated evidence items with sourceRefs or it reads "undetermined". The card puts the read first.

## Files to change
| File | Change |
|---|---|
| `packages/infrastructure/src/business-intelligence/anthropic-understanding.model.ts` | schema fields `constraint`, `stage`; CONSTRAINT / STAGE prompt sections; parser-guided repair of „…" quotes closed with `"` |
| `packages/application/src/bi/contracts.ts` | `constraint?`, `stage?`, `BusinessStage` |
| `packages/application/src/bi/validation.ts` | claim terms match at word start (RO false positives: "recuperare"→rare, "comunicare"→unic); RO differentiation term narrowed |
| `packages/application/src/arc/{contracts,arc.service}.ts` | `ArcUnderstanding.constraint/stage`; projection + gates; cause clause kept when only the consequence is gated; tension restating the constraint leaves "also" |
| `apps/web/src/slice0/ArcSurface.tsx`, `slice0.css`, `api/client.ts`, `i18n/messages.ts` | ConstraintCard first; stage line + fixed implication; tensions as "Also on my mind" (flat) |
| tests | arc, insight-gates, prompt/extractJson, web Arc |

## Tests / verification
- Unit + full gate: tsc (all), eslint (backend + web), `npm test`.
- Dogfood harness, 3 runs each: Body Move (prod fragments, ro), Business Brain (prod fragments, en), 3 operator URLs.
- Browser pane: the card on a local business before deploy.
- **Production verification:** after `approve deploy`, re-read Body Move and Business Brain in prod (Sources → Update my
  understanding) and check the constraint + stage show first.

## Risks
Prompt-level variance (stage flips between runs); claim-gate change affects understanding + conversation (Aha 2) gates
only, not frozen slices. Rollback: revert the commit; older snapshots render unchanged (fields optional).

## Status log
- 2026-10-12: built — prompt fields, gates, projection, card; Body Move 3/3 constraint named, stage growth 2/3 vs
  validating 1/3; Business Brain 3/3 constraint, validating 3/3. Found + fixed: Body Move synthesis failing 3/3 on
  „…" quotes (JSON), claim gate dropping Romanian lines by substring. Gate green (2003 tests). / next — 3 operator URLs,
  browser check / blockers — waiting on the 3 URLs (BUS-64)
- 2026-10-12: operator fixes 1+2 — stage = core + optional secondary area; constraint must be about the business, never
  "you have not shown X" (dig deeper). Business Brain: constraint "no founder has used it and produced a result" 3/3,
  overlap with every tension ≤0.33; stage validating 3/3. Body Move: core stage growth 6/6 (two rounds), but the model
  never fills `secondary`; a schema tweak to fix that is in code but UNTESTED. Stage evidence may now cite the Terms.
  / next — test the secondary tweak on Body Move, then the 3 operator URLs / blockers — local Anthropic key out of credit
- 2026-10-12 (round 3, after credit top-up): Body Move core growth 3/3 + secondary "validating" (medical + corporate
  channels) 3/3 → split stage stable. Business Brain constraint = "no founder has gone through it / produced a result"
  3/3, stage validating 3/3; run b overlap 0.60 with the customer-proof tension (merged off the card). Prod api: zero
  model calls since the 02:52 deploy (logs). Full cards: runs-2026-10-12-round3.md. / next — operator review, then 3 URLs
  / blockers — none (prod key comparison needs `approve prod`)
- 2026-10-12 (round 4, cleanup): RO sales term = phrases only; secondary area lowercased; dash case filtered; questions
  de-duplicated; constraint retry when overlap ≥ 0.45 (one extra call). Business Brain 3 runs: overlap 0.29 / 0.20 / 0.22,
  retry fired once (run b → a different deeper cause: undecided target founder); stage validating 3/3. Gate green.
  Full cards: runs-2026-10-12-round4.md. / next — 3 operator URLs / blockers — none
- 2026-10-12 (round 5, fixed root-cause order users → target → offer → time, in the reading and the retry): Business
  Brain 3/3 at the USERS level ("no founder has used it and got a result"); wording differs; run c phrased as "not yet
  shown" (overlap 0.49) — its retry returned the users-level sentence but was rejected because it still overlaps the
  customer-proof tension (0.45+); card merged that tension. Decision pending: accept the retry and merge. / next —
  operator decision, then 3 URLs / blockers — none
- 2026-10-12 (round 6): retry kept whenever decided (card merges what it overlaps); "not (yet) shown / demonstrated /
  visible" banned in prompt + triggers the retry. Business Brain 3/3 fact-framed "No founder has … and got a result";
  no "not shown". Drift: a+b say "visibly completed … a result you can point to" (visibility as an adverb, not caught);
  c (retried) overlaps raw tensions 0.66 → card merged 2 of 4 tensions. / next — operator review, 3 URLs / blockers — none
- 2026-10-12 (round 7): visibility rule extended ("visibly", "you can point to", "to show") → retry; card keeps the
  fact only (consequence tail cut, visibility adverbs stripped). Business Brain 3/3 "No founder has used Business Brain
  and received a strategy and plan"; no visibility framing; overlap with tensions on the card 0.33 / 0.37 / 0.33; retry
  fired 2/3; stage validating 3/3. Drift: run b says "outside the operator". / next — 3 operator URLs / blockers — none
- 2026-10-12 (round 8, operator URLs, 3 runs each, website only): QuFi — constraint users-level 3/3, validating 3/3.
  BIZZ.CLUB (ro) — stage stable 3/3 (growth core, validating franchise); constraint varies (target 1/3, member results
  2/3, one ro visibility-phrased "publicat pe site" not caught). NoBullshitRecruiter — constraint target-level 3/3;
  stage flips 1/3 (validating core vs growth core). No "not enough evidence" in 9 runs. Fixed: dash left after cutting
  the tail. Found: "engagement" claim term blanks consulting sub-texts. Cards: runs-2026-10-12-new-businesses.md.
  / next — operator review / blockers — none
- 2026-10-12 (round 9, 4 fixes: ro/it visibility, "engagement" narrowed, users level passed when users exist, core =
  most evidence of sales; + parser repair for a value opening with „): NoBullshitRecruiter constraint 5/5 (B2B vs
  individuals), stage growth-core 3/3 in the scored runs (4/5 incl. 2 extra). BIZZ.CLUB stage 3/3 but constraint 3
  different answers (published result / target / offer) → FAILS the deploy condition. Not deployed. / next — make the
  model state the level and why earlier levels pass / blockers — none
- 2026-10-12 (round 10, level fix): constraint.level + levelCheck (passed + evidence per level); code rejects a level
  that is not the first failing one, and "users" at growth/plateau → retry. BIZZ.CLUB 3/3 level = offer (users passed:
  hundreds of members; target passed; offer not passed: no price, no member benefits), run a via the retry. Browser
  check passed (real ArcSurface + harness cards: Body Move split stage, BIZZ.CLUB, Business Brain; desktop + 375px, no
  overflow, no console errors). / next — commit + deploy (needs approve commit + approve deploy) / blockers — gate phrases
- 2026-10-12: done — W1 deployed (a8e7f02, PR #15; api 1049e04f, web a187e736) / next — operator re-reads Business
  Brain + Body Move in prod (Sources → Update my understanding), records Prod verification / blockers — none (BUS-64)
