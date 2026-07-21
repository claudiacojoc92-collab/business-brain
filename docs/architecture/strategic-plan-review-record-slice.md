# Strategic Plan Review Record — slice architecture

Implements the founder-explicit **Strategic Plan Review Record (SPRR)**, extending ADR-011 category 12 (Plan) with a
review capability. Smallest durable design that lets a founder record an append-only assessment of an exact plan revision
— observations, assumption/dependency/milestone assessments, context changes, a conclusion, and an intended disposition —
**without** mutating the plan/commitment/decision or creating any execution/task/score object. Recorded before
implementation; governed by [`strategic-plan-review-record-contract.md`](../governance/strategic-plan-review-record-contract.md).

---

## Part 1 — Repository audit (recorded before any code change)

**No existing structure is a plan review, and no action reviews a plan.** Every review/progress/outcome-like field:

| Field / structure | Founder / model / deterministic | Persisted? | Historical? | Lifecycle-changing? | Execution-like? | Confusable with an SPRR? |
|---|---|---|---|---|---|---|
| Plan `reviewConditions` / `exitConditions` / `expiresAt` | founder-authored | yes (on the plan) | plan-time | no | no | **No** — planning-time *conditions*, not a review record |
| Plan `Milestone.statusAtPlanning = 'PLANNED'` | deterministic | yes | plan-time snapshot | no | **no** — the only value is `PLANNED` | **No** — a historical snapshot, not an execution/task state |
| Plan `Assumption {statement,status}` / `Dependency {statement,kind,availability}` | founder-authored | yes | plan-time | no | no | No — the *original* elements a review will assess (copied, never rewritten) |
| Plan `conflicts` (deterministic feasibility) | deterministic (system) | yes | plan-time | no | no | No |
| Commitment `reviewAt` / `reviewTrigger` | founder-authored | yes | — | no | no | **No** — a commitment review *condition*, not a plan review |
| `recommendation.nextStep` | model-produced | yes (in the immutable recommendation) | — | no | no | No — a single suggested action |
| `business.market_review` (`PgMarketReviewRepository`) | Wave-3 competitor-site review | yes | — | market lifecycle | no | **No** — reviews a *competitor site's findings*, a different domain |
| legacy `memory.*` (recommendations/threads) | M2/ADR-010 | yes | — | — | no | No — KA-2, untouched |

**Confirmed:** no current route auto-reviews a plan (strategy routes have no plan-review endpoint); no expiry process
creates a review; a commitment review condition does not create a plan review; `Milestone.statusAtPlanning` is a
historical snapshot, not an execution state; no recommendation feedback is a plan review; no model output can alter plan
lifecycle (the model isn't in the plan/commitment/decision paths); `MODEL_PROPOSED` authorship exists in enums but **no
model-generation path uses it** (this slice adds none). No `progress`/`score`/`execution`/`plan_review` table exists (the
only "progress"/"review" DB matches are `business.market_review` and Postgres-internal `pg_stat_progress_*` catalog views).

**Conventions to mirror** (identical to SDR/SCR/SPR): ULID `generateId()`; append-only immutable rows + a **BEFORE-UPDATE
trigger forbidding UPDATE**; idempotent create via unique `(founder, idempotency_key)`; `db.transaction`; deletion explicit
per-table in `delete.service.ts`; export founder-safe sections; the plan repo's `getHistory`/`getEffective` resolve the
exact plan revision the review links to.

---

## Part 2 — Domain model (schema `strategic-plan-review-1`)

One **append-only** table, `business.strategic_plan_review_record`. A review is a **standalone immutable record** (each
review of a plan is its own record; a *correction* is another append-only review — Law 16). Columns keep `logical_review_id`
+ `revision` for shape parity (each create is a fresh logical review at revision 1; revision-based corrections deferred).

- `id` (ULID) · `founder_id` · `logical_review_id` · `revision` · `schema_version`
- **Plan/lineage linkage (SYSTEM_DERIVED, Law 5/15):** `plan_record_id` (the **exact** reviewed plan revision id),
  `plan_logical_id`, `plan_revision`, `plan_schema_version`, `commitment_record_id`, `commitment_revision`,
  `decision_record_id`, `recommendation_session_id`, `provenance_manifest_version`, `grounding_status_at_planning`,
  `alignment_at_planning`
- **Founder-authored:** `review_statement`, `review_period_start` / `review_period_end` (optional), `observations` (jsonb[]),
  `evidence_references` (jsonb[] — lineage-only), `assumption_assessments` (jsonb[]), `dependency_assessments` (jsonb[]),
  `milestone_assessments` (jsonb[]), `context_changes` (jsonb[]), `unresolved_unknowns` (string[]),
  `review_conclusion`, `selected_disposition`
- `authorship` (jsonb map) · `idempotency_key` · `created_at`

No `lifecycle` column — a review is descriptive and **never mutated** (append-only + trigger). No plan-status admission
block: **any** founder-owned plan revision (ACTIVE/SUPERSEDED/RETIRED/CANCELLED/EXPIRED) may be reviewed historically.

### Observation
`{ observationId, statement, sourceType: FOUNDER_REPORTED|BUSINESS_RECORD_REFERENCE|PUBLIC_REFERENCE|SYSTEM_DERIVED,
evidenceRef:string|null, observedAt:date|null, certainty:'LOW'|'MEDIUM'|'HIGH'|'UNKNOWN', authorship }`. A `FOUNDER_REPORTED`
observation is **never** marked externally verified.

### Evidence reference (lineage-only — Law: no arbitrary raw ids)
`{ space: STRATEGIC_PLAN|STRATEGIC_COMMITMENT|STRATEGIC_DECISION|STRATEGIC_SESSION|PROVENANCE_MANIFEST, id }`, validated
**deterministically** against the reviewed plan's own lineage set (`plan_record_id`, `commitment_record_id`,
`decision_record_id`, `recommendation_session_id`, `provenance_manifest_version`). Anything else is a founder observation,
not a verified reference. (Broader governed evidence spaces are deferred.)

### Assumption assessment (maps to the exact original assumption — Part 6)
`{ originalIndex:int, originalStatement, originalStatusAtPlanning, assessment: STILL_UNKNOWN|SUPPORTED|CONTRADICTED|
PARTIALLY_SUPPORTED|NO_LONGER_RELEVANT|NOT_REVIEWED, explanation:string|null }`. `originalIndex` must reference an existing
plan assumption; the original statement/status are copied (PLAN_DERIVED) — the review **never** rewrites the stored plan.
A newly discovered assumption is a `contextChange` / observation, not a plan assumption.

### Dependency assessment (maps to the exact original dependency — Part 7)
`{ originalIndex:int, originalStatement, originalKind, originalAvailability, assessment: AVAILABLE|UNAVAILABLE|DEGRADED|
UNKNOWN|NO_LONGER_REQUIRED|NOT_REVIEWED, explanation:string|null }`.

### Milestone assessment (bounded; no percentage — Part 8/Law 12)
`{ milestoneId, originalLabel, assessment: NOT_REVIEWED|EVIDENCE_NOT_AVAILABLE|CONDITION_NOT_MET|CONDITION_PARTIALLY_MET|
CONDITION_MET|CONDITION_NO_LONGER_RELEVANT|CONDITION_CANNOT_BE_DETERMINED, explanation:string|null }`. `milestoneId` must
match a milestone in the reviewed plan. No percent-complete/overdue/on-track/failed.

### Context change (Part 9; never auto-written to FSC/BU)
`{ category: MARKET|CUSTOMER|OFFER|RESOURCE|CAPACITY|FINANCIAL|REGULATORY|PERSONAL_CONSTRAINT|STRATEGIC_PRIORITY|EVIDENCE|
OTHER, statement }`. Records only what the founder reported for this review; promotion into governed context is a separate
future gate.

### Review conclusion (descriptive; not SUCCESS/FAILURE)
`PLAN_REMAINS_COHERENT | PLAN_NEEDS_REVISION | PLAN_NO_LONGER_COHERENT | COMMITMENT_REVIEW_NEEDED | INSUFFICIENT_INFORMATION
| MIXED_EVIDENCE`.

### Selected disposition (founder intent; **never** executes)
`CONTINUE_CURRENT_PLAN | CREATE_REVISED_PLAN | SUPERSEDE_PLAN | ABANDON_PLAN | RETIRE_PLAN | RECONSIDER_COMMITMENT |
TAKE_NO_ACTION | GATHER_MORE_INFORMATION`. Recording it performs **no** lifecycle action.

---

## Part 3 — Admission gate (deterministic; no model)
All must hold: (1) explicit founder POST; (2) the `:logicalPlanId` resolves to a plan **owned** by the founder; (3) the
target plan revision (an optional `planRecordId`, else the effective revision) exists in that plan's history; (4) a
`review_statement` **or** ≥1 bounded assessment/observation; (5) `review_conclusion` explicit + valid; (6)
`selected_disposition` explicit + valid; (7) every assessment enum valid; (8) every `assumption/dependency` assessment
`originalIndex` is within the plan's arrays; (9) every `milestone` assessment `milestoneId` exists in the plan; (10) every
`evidenceReference` resolves to the plan's own lineage set; (11) valid date order (`review_period_start ≤
review_period_end`); (12) idempotency key present. **No plan-status block** — inactive plans may be reviewed historically.
Creating a review writes **only** the review record: **no** plan/commitment/decision lifecycle mutation, **no** revised
plan.

## Part 4 — Lifecycle separation (Part 12)
`POST /strategy/plans/:logicalPlanId/reviews` is create-only. Plan lifecycle (`supersede`/`retire`/`cancel`) and
commitment lifecycle remain **separate** explicit endpoints. `selectedDisposition = CREATE_REVISED_PLAN` records intent
only; the UI may then offer a separate "Create revised plan" action (an ordinary plan supersede). `RECONSIDER_COMMITMENT`
records intent only; the UI may link to the commitment surface. **No chained writes behind one confirmation.**

## Part 5 — Read-time derivations (Part 13; no normative states)
The review view exposes: `linkedCommitmentStatus` (current effective commitment vs the reviewed lineage — neutral), and
`newerPlanRevisionExists` (the reviewed `plan_revision` < the plan's latest). A list exposes reviews per plan (newest
first) with the reviewed plan revision + its status label. **No** `REVIEW_OVERDUE`/`NEGLECTED`/`STALE`/`NONCOMPLIANT`; no
scheduling/notifications.

## Part 6 — API (bounded)
`POST /strategy/plans/:logicalPlanId/reviews` (create, gated, idempotent) · `GET /strategy/plans/:logicalPlanId/reviews`
(all reviews for the plan) · `GET /strategy/plan-reviews/:reviewId` (one review + its reviewed-plan context). No PATCH/
UPDATE; review creation is **never** combined with a lifecycle mutation. Cross-founder → 404.

## Part 7 — UI
A **separate** "Review this plan" surface. The exact historical plan (title, intent, original milestones/assumptions/
dependencies/uncertainty, alignment/grounding) renders **read-only**; the founder adds observations and assesses each
assumption/dependency/milestone independently, notes context changes and unresolved unknowns, then selects a **conclusion**
and an **intended disposition** (kept visually separate). States prominently: "This records your review. It does not change
the plan or commitment." A separate explicit **Record this review**. A quiet historical notice if a newer plan revision or
a changed commitment now exists. No success/failure score, no percentage, no task checkboxes, no streaks/overdue/guilt/
celebration.

## Part 8 — Export / delete
Export adds `strategicPlanReviews` (all review records + exact plan/commitment/decision/session/manifest links + plan
schema version + observations + assessments + context changes + unresolved unknowns + conclusion + disposition + labelled
`authorship`; founder-reported observations are **not** exported as verified evidence). Account deletion removes
`business.strategic_plan_review_record`; zero orphans.

## Migration & versions
- **V075** `business.strategic_plan_review_record` (+ append-only trigger). Latest after V074.
- Review schema `strategic-plan-review-1` (independent). Recommendation / manifest / decision / commitment / plan schemas
  + prompt **unchanged**. Prior records untouched and readable.

## Deferred debt
- **SPRR-1** revision-based review corrections (a `SUPERSEDE`-style append on the same logical review).
- **SPRR-2** broader governed evidence spaces (business records / public references) + their ownership validation.
- **SPRR-3** governed promotion of a review context change into FSC/BU (separate gate) — explicitly not automatic here.
- **SPRR-4** model-assisted review summarization (MODEL_PROPOSED + validation + evaluation).
- Strategic **Execution Record** remains future-only; task/progress tracking stays outside the architecture; Strategic
  **Memory** is conceptual; **PI-1** / **KA-2** unchanged.
