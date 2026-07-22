# Show Me the Loop — rendered-journey audit (2026-07-22)

A rendered-product milestone, not a governance slice. Goal: the first complete, visible, filmable founder journey
Recommendation → Decision → Commitment → Plan → Execution Report → Outcome Review → Possible Learning → Strategic Learning
→ Promotion → future Recommendation, with backward navigation through the exact lineage. No new canonical object; a
deterministic read projection over accepted records + a rendered thread view.

## Rendered state today (grounded in the shipped UI at `626c0c6`)
`apps/web/src/strategy/StrategyPage.tsx` renders the loop as **separate, unlinked regions**:
- A session renders `RecommendationView → DecisionPanel → CommitmentPanel → PlanPanel` **nested** — so Recommendation →
  Decision → Commitment → Plan is visible *within one session block*.
- `PlansPanel` (a **separate** section) lists plan revisions, each with `ExecutionAccounting`, `OutcomeReviewPanel`, and the
  possible-learning cards. So Plan → Execution → Outcome Review → Possible Learning → Strategic Learning lives in a region
  **not visually connected** to the session/recommendation that produced the plan.
- `LearningsList` (a **third** section) shows kept learnings + promotion.
- A later session shows "Reasoned from snapshot {hash}…" but **does not disclose which promoted learning that snapshot
  included**, and offers **no** navigation back to the learning → candidate → outcome review → execution → plan → original
  recommendation.
- There is **no** `/strategy/thread` route and **no** strategic-thread projection endpoint. (`thread.ts` / `thread-service.ts`
  are the unrelated *memory* conversation-thread system.)

## Gap table

| Journey step | Rendered now | Missing | Required fix |
|---|---:|---|---|
| Open a Recommendation | Yes (session block) | not framed as the start of one thread | thread view rooted at the session |
| Record a Decision | Yes (nested action) | — | keep; surface in thread |
| Create a Commitment | Yes (nested) | — | keep; surface in thread |
| Create a Plan | Yes (nested) | plan appears again, separately, in PlansPanel | link the two views |
| Report execution | Yes (PlansPanel) | not linked to the originating recommendation | thread groups them |
| Review the outcome | Yes (OutcomeReviewPanel) | not linked upstream | thread groups them |
| Create a possible learning | Yes (candidate card) | not linked upstream | thread groups them |
| Keep as Strategic Learning | Yes (adopt) | resulting learning shown only in LearningsList | thread shows it inline |
| Promote it | Yes (LearningsList) | promotion status not shown in thread | thread shows promotion status |
| Later Recommendation includes it | Partially (snapshot has promotedLearnings) | **no disclosure that this recommendation's context included this learning** | bounded usage disclosure |
| Inspect the later Recommendation | Yes (session block) | no back-link to the promoted learning | usage list + links |
| Back → Strategic Learning | **No** | not clickable | lineage link |
| Back → exact Candidate revision | **No** | not clickable | lineage link |
| Back → exact Outcome Review | **No** | not clickable | lineage link |
| Back → Execution Report | **No** | not clickable | lineage link |
| Back → exact Plan revision | **No** | not clickable | lineage link |
| Back → original Recommendation | **No** | not clickable | lineage link |
| Understand the chain without docs | **No** | the founder must mentally stitch three regions + guess the later-rec link | one thread view |

## Classification

**B — the records exist, but the founder must manually locate and mentally connect them.** The forward chain is real but
split across three unlinked regions; the backward chain from a later Recommendation to the promoted Learning and original
strategic history is **not navigable at all** (the sharpest instance, bordering D). Every canonical record and every exact
provenance reference already exists in the database — nothing new needs to be persisted; what is missing is a **deterministic
read projection** that assembles the thread and a **rendered thread view** that makes forward actions and backward lineage
visible and clickable.

## Consequence for the slice
Because all provenance already exists (session→decision→commitment→plan→execution→outcome-review→candidate→learning→promotion,
and later-session→snapshot→promotedLearnings), the fix is a **non-canonical read projection + UI**, with **no migration**
(see the contract's no-migration proof). The demo story is a deterministic, dev-guarded fixture reusable by Playwright and by
a human recording.
