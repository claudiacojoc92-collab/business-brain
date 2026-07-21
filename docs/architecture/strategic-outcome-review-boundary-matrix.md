# Strategic Outcome Review Boundary — criterion-to-test matrix

Maps the ADR-016 acceptance criteria + the prompt's TESTS/PLAYWRIGHT items to their covering tests. **det** =
`strategic-outcome-review.test.ts`; **live** = `strategic-outcome-review.live.test.ts` (A–H); **e2e** =
`strategic-outcome-review.spec.ts`. Impl: **dom** = `strategic-outcome-review.ts`; **repo** =
`pg-strategic-outcome-review.repository.ts`; **api** = `strategy.routes.ts`; **mig** = `V086__strategic_outcome_review.sql`;
**ui** = `StrategyPage.tsx` (`OutcomeReviewPanel`); **exp/del** = `export.service.ts` / `delete.service.ts`.

| Criterion (ADR-016 / prompt) | Impl | Test | Status |
|---|---|---|---|
| Review cannot mutate history (immutable + append-only; UPDATE/DELETE rejected) | mig/dom | live B · e2e (plan/exec unchanged) | COVERED |
| A later Review never edits an earlier (byte-identical) | dom/repo/mig | live D · e2e (#1 hash unchanged after #2) | COVERED |
| Review cannot update Recommendation / regenerate understanding | api/dom | live C (counts unchanged) | COVERED |
| Review cannot create Learning | (no wiring) | live C (learnings unchanged) · e2e (learning count 0) | COVERED |
| Review cannot promote / change Effective Context | (no wiring) | live C (promotions/snapshots unchanged) | COVERED |
| Review changes no Plan/Execution/Decision/Commitment | api/dom | live C (plan+exec byte-equal, counts unchanged) | COVERED |
| Inputs are immutable — exact plan revision + exact snapshot, no "latest" | api | api (getByRevisionId + snapshot getById) · live A | COVERED |
| Frozen reproducible snapshot (plan/exec/snapshot/evidence/outcome + prompt hash + model config + schema + timestamp) | dom/mig | det (hash) · live A/H (stored == recompute) | COVERED |
| Deterministic assessment, no judgment model | dom/mig | det (method) · e2e (assessment_method + model_configuration={}) | COVERED |
| Records five things; answers no "what next" (no disposition/next-step) | dom | det (view has no score/disposition/nextstep) · e2e (no % / "not a score") | COVERED |
| Unknown is first-class; survives unchanged; never converted to failure | dom | det (UNKNOWN) · live E · e2e (Unknown shown explicitly) | COVERED |
| No hindsight — later evidence → new Review; earlier identical | dom/repo | live D · e2e | COVERED |
| No verification / no scoring / no coaching | dom/ui | det (notVerified/notAScore) · e2e ("not a score", no %) | COVERED |
| Founder-owned, isolated, exportable, forgettable (zero orphans) | repo/exp/del | live F (isolation) · live G (delete) · export mapping | COVERED |
| Distinct from the Strategic Plan Review (unchanged) | (separate table/routes/UI) | full plan-review-test regression green | COVERED |
| UI distinguishes Execution Report vs Review; no score/rating | ui | e2e (distinct section, no %/score) | COVERED |
| Playwright: create plan → report → review visible → cannot edit plan/exec → no learning → Unknown → 2nd leaves 1st unchanged | ui | **e2e** (+ evidence PNGs) | COVERED |

**Invariant proved:** the Strategic Outcome Review is an immutable, deterministic, reproducible object that **describes but
never changes** Business Brain history.
