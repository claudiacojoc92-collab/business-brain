# Understanding eval

Measures the first read ("Understanding") on seven real businesses, the way the medical guard was measured. It was
built on 2026-10-17 to recover the understanding after the 10-15 regression; the plan and the operator's decisions are
in `intent/2026-10-17-understanding-regression/plan.md`.

**What it measures:** the text the founder actually sees on the card, not the model's raw output. Between the model and
the screen sit the understanding governance, the arc projection, the thesis and founder-projection layer, and the web
card. Any of them can change the result, so the eval runs all of them.

## The pieces

| File | What it is | Committed |
|---|---|---|
| `businesses.ts` | The seven businesses, their production ids and the pre-regression snapshot to compare against | yes |
| `manifest.json` | Per fixture: export date, fragment count, sha256 of the fragment ids and of their content | yes |
| `run.eval.test.ts` | Stage A: the production chain on each fixture (real model calls) → `.eval/understanding/runs/<label>/` | yes |
| `apps/web/src/test/understanding-render.eval.test.tsx` | Stage B: renders each view through the real card → `.eval/understanding/rendered/<label>/` | yes |
| `rubric.ts`, `rubric.test.ts` | The bar, as fixed checks (independent of the product's governance, so it cannot move with the code) | yes |
| `report.ts` | Scores a label plus the old outputs → `.eval/understanding/reports/<label>.md` | yes |
| `.eval/understanding/fixtures/` | Real client material (website pages, Instagram, a founder document) | **never** (git-ignored) |

Client documents do not go into a repository (operator, 2026-10-17; the same line as 10-06). The fixtures can always be
rebuilt from production with the export below; the manifest hashes show whether a rebuilt fixture matches.

## Rebuild the fixtures (read-only production access)

The export maps each business's linked evidence fragments with the deployed repository code, so the fixture is exactly
what `bridgePourIn` reads. For each `slug:businessId` in `businesses.ts`:

```bash
railway ssh --service api "cd /app && node - <businessId>" < tools/understanding-eval/export.js > .eval/understanding/fixtures/<slug>.json
```

The pre-regression snapshots (`oldSnapshotId`) go to `.eval/understanding/old/<slug>.json`.

## Run

```bash
BB_UNDERSTANDING_EVAL=1 BB_EVAL_LABEL=baseline BB_EVAL_RUNS=3 npx vitest run tools/understanding-eval/run.eval.test.ts
BB_UNDERSTANDING_RENDER=1 BB_EVAL_LABEL=baseline npx vitest run apps/web/src/test/understanding-render.eval.test.tsx
npx vite-node tools/understanding-eval/report.ts baseline
```

Stage A makes paid model calls (about three per business and run). Measured on 2026-10-17: one run alone takes about
5 minutes; four in parallel finish in about 10–12 minutes; seven in parallel slowed every run to 8–16 minutes and three
requests timed out. The runner therefore runs at most four at a time, and it is resumable: a run that already wrote a
view is skipped (BB_EVAL_FRESH=1 redoes everything). Watch it by the count of files written, not by "still running".
Both stages are env-gated, so the normal `npm test` never runs them; the rubric's unit tests always run.

## The bar (operator, 2026-10-17)

Per business: a decided constraint with a cause (not a symptom), 3–4 ranked tensions naming concrete services and
numbers, a stage that is not "undetermined" when the evidence supports one, no website housekeeping in the tensions,
no behaviour predictions, BB's text in the business's content language, the business named as its own material names
it, and no sentence that appears on more than one business's card. Those checks are deterministic. Above them sits the
one human question, answered by the operator per business, and it is the bar that does not move: would she send this
card to a paying client?

The baseline (2026-10-17): no, for all seven. None had a constraint, so cause vs symptom was dropped as a column.
