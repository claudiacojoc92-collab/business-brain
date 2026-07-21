# Strategic Plan Review Record — slice closure record

Extends ADR-011 category 12 (Plan) with a founder-explicit **review sub-capability**: an append-only assessment of an
exact plan revision that returns the founder to an informed choice and **changes nothing**. Governance + architecture gate
committed *before* implementation (`e8f57bc`, atop the SPR line `466d0d4`).

## Gate (committed first — `e8f57bc`)

- **Audit (Part 1):** no existing structure is a plan review and no action reviews a plan. Plan `reviewConditions`/
  `exitConditions` are planning-time conditions; `Milestone.statusAtPlanning='PLANNED'` is a historical snapshot (not
  execution/task state); commitment `reviewAt`/`reviewTrigger` are commitment conditions; `business.market_review` is the
  Wave-3 competitor-site review (different domain); the legacy `memory.*` is untouched (KA-2). No progress/score/execution/
  plan-review table exists (only `market_review` + Postgres `pg_stat_progress_*`). No model path uses `MODEL_PROPOSED`.
- **Governance contract** — [`strategic-plan-review-record-contract.md`](../governance/strategic-plan-review-record-contract.md):
  19 laws (review-is-not-execution; not-judgment-of-founder; explicit act; does-not-preserve-plan-by-default; historical
  plan immutable; observation/interpretation/conclusion separate; missing-evidence-stays-missing; activity-is-not-outcome;
  outcome-is-not-causation; explicit assumption/dependency/milestone states with no percentages; review-and-lifecycle
  distinct; does-not-rewrite-commitment; no-retrospective-certainty; append-only; no-compulsory-review; export/isolation/
  delete; constitutional supremacy).
- **Architecture record** — [`strategic-plan-review-record-slice.md`](../architecture/strategic-plan-review-record-slice.md):
  one append-only table, deterministic admission gate, schema `strategic-plan-review-1`. **Model role: none.**

## What was built (implementation — `e8f57bc`+1)

**Domain** — [`strategic-plan-review.ts`](../../apps/api/src/business-model/strategic-plan-review.ts): the deterministic
admission gate `assertReviewAdmissible` (owned plan revision; a review statement **or** ≥1 assessment/observation;
conclusion + disposition required and valid; every assessment enum valid; assumption/dependency `originalIndex` within the
plan's arrays; milestone `milestoneId` exists in the plan; every evidence reference resolves to the plan's **own lineage**
set; valid date order; idempotency) — **no plan-status block** (inactive plans reviewable historically);
`buildReviewFields` (lineage links SYSTEM_DERIVED from the immutable plan; original assumption/dependency/milestone text
copied PLAN_DERIVED so the review stays interpretable **without rewriting the plan**; founder-reported observations keep
their source and are never marked verified); `linkedCommitmentStatusForReview` (neutral read-time notice). **No model, no
lifecycle mutation.**

**Persistence** — `V075 business.strategic_plan_review_record` (append-only immutable records; **BEFORE-UPDATE trigger**;
unique `(founder, idempotency_key)`; observations/assessments/context changes as JSONB — no task/progress/score table).
[`pg-strategic-plan-review.repository.ts`](../../apps/api/src/business-model/pg-strategic-plan-review.repository.ts):
idempotent create-only; `listByPlan`; `getById`.

**API** — [`strategy.routes.ts`](../../apps/api/src/routes/strategy.routes.ts):
`POST /strategy/plans/:logicalPlanId/reviews` (create, gated, idempotent — targets an optional exact `planRecordId`, else
the effective revision; **any** revision reviewable), `GET /strategy/plans/:logicalPlanId/reviews`,
`GET /strategy/plan-reviews/:reviewId` (+ neutral `linkedCommitmentStatus` / `newerPlanRevisionExists` /
`reviewedPlanStatusNow`). **No PATCH; review creation is never combined with a lifecycle mutation.** Cross-founder → 404.

**Export/Delete** — export adds `strategicPlanReviews` (all reviews + exact plan/commitment/decision/session/manifest
links + observations + assessments + context changes + conclusion + disposition + labelled `authorship`; founder-reported
observations are not exported as verified evidence); account deletion removes `business.strategic_plan_review_record`
before the plan delete (zero orphans).

**UI** — [`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx): a **separate** "Review this plan" surface,
offered only after a plan is activated. The plan renders read-only; the founder records observations, assesses each
milestone/assumption/dependency via bounded dropdowns (no percentages, no checkboxes), notes unknowns, then selects a
**conclusion** and an **intended disposition** (kept visually separate — no option privileged). States "This records your
review. It does not change the plan or commitment."; a separate explicit **Record this review**; the disposition is intent
only (`CREATE_REVISED_PLAN`/`RECONSIDER_COMMITMENT` execute nothing). No success/failure score, streaks, overdue, guilt, or
celebration. Schema `strategic-plan-review-1` (all prior schemas unchanged).

## Acceptance evidence

- **Deterministic (Part 17):** `strategic-plan-review.test.ts` — 17 tests (admission gate incl. inactive-plan-reviewable,
  conclusion/disposition required, nothing-to-review, assumption/dependency index bounds, milestone-not-found,
  evidence-lineage-only, enum/date validation; build maps to the exact original elements without rewriting the plan;
  founder-reported observations not verified; authorship separation; no execution/task/score field; linked-commitment
  status).
- **Live DB (Part 18 + Scenarios):** `strategic-plan-review.live.test.ts` — 7 tests: plan creation/time/expiry create
  **no** review (and no execution/task/progress table); explicit review exactly-once + idempotent; exact plan-revision
  linkage; a review **mutates nothing** (plan/commitment unchanged, no new plan revision from `CREATE_REVISED_PLAN`
  intent); an inactive (cancelled) plan revision is reviewable historically **without reactivation**; append-only UPDATE
  rejected; cross-founder create/read rejected without leakage; export faithful (authorship + FOUNDER_REPORTED preserved),
  deletion zero orphans, no `memory.*` write.
- **Browser (Part 19):** the full chain decision → commitment → plan → **review** are all separate acts — activating a
  plan reveals a distinct "Review this plan" affordance ("It changes nothing on its own"). Recording a review through the
  real UI→API persisted MIXED_EVIDENCE / GATHER_MORE_INFORMATION with a FOUNDER_REPORTED observation (not verified) and a
  bounded milestone assessment `CONDITION_PARTIALLY_MET` (**no percentages/checkboxes/scores**); "It does not change the
  plan or commitment" was visible; conclusion and disposition are separate; the **plan stayed ACTIVE at revision 1** —
  the review mutated nothing; the review lists back with `notLifecycleAction: true`.
- **Regression:** backend **897 pass / 1 skip**; web build (tsc + vite) + 73 web tests green; API + web typechecks clean;
  migrations V066–V075 present, V075 table + append-only trigger live; frozen-engine hashes byte-identical; Strategic
  Decision/Commitment/Plan + provenance (KA-1) + conflict rules remain green; recommendation `ACCEPT` and BU `accept`
  semantics unchanged; a review creates no lifecycle mutation.

## Scope discipline

No Strategic Execution Records, task completion, progress percentages, productivity scoring, habit/time tracking,
reminders/notifications/calendars/scheduling/project-management integrations, agents/autonomous actions, or inferred
execution added; the legacy `memory.*` schema (KA-2) not reconciled; no generic Strategic Memory; the model cannot
create/finalize a review or judge founder success/failure/compliance; creating a review performs **no** plan/commitment/
decision lifecycle mutation and no automatic context promotion; the frozen engine untouched. Not deployed, not pushed, no
prior commit amended.

## Remaining debt
- **SPRR-1** revision-based review corrections; **SPRR-2** broader governed evidence spaces + ownership validation;
  **SPRR-3** governed promotion of a review context change into FSC/BU (separate gate); **SPRR-4** model-assisted
  summarization (MODEL_PROPOSED + validation + evaluation).
- Strategic **Execution Record** remains future-only; task/progress tracking stays outside the architecture; Strategic
  **Memory** is conceptual; **PI-1** / **KA-2** unchanged.
