# Strategic Plan Review Record — Governance Contract

**Status: FROZEN.** Governs the founder-explicit **Strategic Plan Review Record (SPRR)**: an append-only assessment of
what has changed since a Strategic Plan was activated — what evidence now exists, which assumptions/dependencies remain
valid, whether the plan is still coherent, and what the founder chooses to do next. Written and committed *before*
implementation. Companion architecture record: [`strategic-plan-review-record-slice.md`](../architecture/strategic-plan-review-record-slice.md).

Governed by [ADR-011](../adr/ADR-011-knowledge-architecture.md) and the Business Brain Constitution. Builds on the
Strategic Plan Record ([contract](strategic-plan-record-contract.md)) — a review always references an exact plan revision.

## Why

The purpose of review is **not to preserve the plan**. It is to return the founder to an **informed choice**. A review is
not proof of execution, a task-completion report, a performance score, a productivity judgment, a founder-personality
assessment, an automatic plan/commitment change, an execution record, a retrospective claim that the decision was
correct/incorrect, or a mechanism that pressures the founder to continue.

## The nineteen laws

### Law 1 — Review is not execution
A review may describe founder-supplied observations and evidence. It does not prove work occurred unless bounded evidence
explicitly supports that claim.

### Law 2 — Review is not judgment of the founder
The review evaluates the plan, assumptions, dependencies, evidence, context, and strategic coherence. It must **not**
evaluate the founder's discipline, courage, consistency, intelligence, seriousness, motivation, worth, or personality.

### Law 3 — Explicit founder review act
A review is created only through an explicit founder action on a visible review surface. **No review from** time passing,
plan expiry, inactivity, recommendation feedback, browser activity, inferred external behaviour, calendar events, or model
inference.

### Law 4 — Review does not preserve the plan by default
The product must not optimize for continuation. A valid review may support `CONTINUE`, `REVISE`, `SUPERSEDE`, `ABANDON`,
`RETIRE`, `RECONSIDER_COMMITMENT`, or `INSUFFICIENT_INFORMATION`. No option is visually or linguistically privileged merely
because it retains the user.

### Law 5 — Historical plan remains immutable
A review never rewrites the original plan, its assumptions/unknowns/conflicts at activation, its milestone definitions, or
its plan-time evidence state.

### Law 6 — Observation, interpretation, and conclusion remain separate
The review distinguishes founder-reported observation; referenced evidence; deterministic comparison; model-proposed
interpretation (if any); founder conclusion; and founder-selected disposition. They are never merged into one
authoritative narrative.

### Law 7 — Missing evidence remains missing
A founder may review without complete information; the review preserves uncertainty. Absence of evidence is never
converted into success, failure, progress, stagnation, or proof the plan should continue.

### Law 8 — Activity is not outcome
Reported activity is not automatically interpreted as milestone achievement, strategic progress, outcome creation, or
assumption validation.

### Law 9 — Outcome is not causation
Observed outcomes are not automatically attributed to the plan; external factors, timing, luck, and unknown causes stay
visible where relevant.

### Law 10 — Assumption review is explicit
Each reviewed assumption is classified only through a bounded state: `STILL_UNKNOWN`, `SUPPORTED`, `CONTRADICTED`,
`PARTIALLY_SUPPORTED`, `NO_LONGER_RELEVANT`, `NOT_REVIEWED`. "Validated" is not used where the evidence supports only a
weaker claim.

### Law 11 — Dependency review is explicit
Each dependency is classified independently: `AVAILABLE`, `UNAVAILABLE`, `DEGRADED`, `UNKNOWN`, `NO_LONGER_REQUIRED`,
`NOT_REVIEWED`.

### Law 12 — Milestone review does not create task status
Milestone review assesses whether the strategic state / evidence condition exists. **No** percent-complete, checked,
assigned, overdue, velocity, time-spent, or productivity metrics.

### Law 13 — Review and lifecycle action are distinct
Creating a review must **not** automatically supersede/cancel/retire the plan or alter the commitment/decision. After
reviewing, the founder may separately choose a governed lifecycle action; the review record and any lifecycle event remain
separately represented and explicitly confirmed.

### Law 14 — Plan review does not rewrite commitment
A review may surface that the commitment should be reconsidered. It must not silently release/retire/supersede the
commitment.

### Law 15 — No retrospective certainty
Later information must not make the historical plan appear more certain than it was at activation.

### Law 16 — Append-only review history
SPRRs are immutable. Corrections or updated reviews require **another** append-only review record. No UPDATE of historical
reviews (enforced in the database).

### Law 17 — No compulsory review
The founder may leave without reviewing. No shame, no red overdue state, no streak loss, no escalation pressure.

### Law 18 — Export, isolation, and deletion
Reviews are founder-inspectable, historically linked, exportable, founder-isolated, and account-deletable.

### Law 19 — Constitutional supremacy
Apply the test: **"Does this serve the founder's clarity and sovereignty, or the product's hold?"**

## Authorship boundary

Every field is exactly one of **FOUNDER_AUTHORED** / **FOUNDER_REPORTED** (observations, statements, assessments,
conclusion, disposition), **PLAN_DERIVED** (original plan elements copied for historical interpretability, labelled),
**MODEL_PROPOSED** (an interpretation — not used this slice), or **SYSTEM_DERIVED** (links, versions, grounding,
alignment, derived notices). Never merged. A **FOUNDER_REPORTED** observation is never marked externally verified.

## Model role (this slice)

**None.** The founder authors every review element; the review is validated deterministically. No LLM path exists, so no
LLM evaluation applies. If model summarization is added later, it may only summarize, stays MODEL_PROPOSED, cannot judge
founder performance, cannot choose the disposition, cannot activate lifecycle actions, cannot invent observations, cannot
turn activity into outcomes, and any provenance-bearing claim is subject to Recommendation Provenance Integrity.

## Scope boundary

This slice records founder reviews of existing Strategic Plans. It does **not** add Strategic Execution Records, task
completion, progress percentages, productivity scoring, habit/time tracking, reminders/notifications/calendars/scheduling/
project-management integrations, agents/autonomous actions, or inferred execution; reconcile the legacy `memory.*` schema
(KA-2); create generic Strategic Memory; let the model create/finalize a review or determine that a founder
succeeded/failed/complied/should-continue; or modify the frozen engine. Creating a review performs **no** plan/commitment/
decision lifecycle mutation. `strategic-plan-review-1` is a new, independent schema version — all prior schemas/prompt
versions unchanged.
