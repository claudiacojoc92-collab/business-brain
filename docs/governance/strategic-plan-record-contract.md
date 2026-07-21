# Strategic Plan Record — Governance Contract

**Status: FROZEN.** Governs the founder-explicit **Strategic Plan Record (SPR)**: a bounded translation of ONE explicit,
effective **Strategic Commitment** into a sequence of intended strategic moves, milestones, review conditions,
assumptions, and dependencies. Written and committed *before* implementation. Companion architecture record:
[`strategic-plan-record-slice.md`](../architecture/strategic-plan-record-slice.md).

Governed by [ADR-011](../adr/ADR-011-knowledge-architecture.md) (category 12 — Plan) and the Business Brain Constitution.
Builds on the Strategic Commitment Record ([contract](strategic-commitment-record-contract.md)) — a plan always
references an effective commitment.

## Why

A **commitment** answers *"What am I agreeing to maintain or pursue?"*. A **plan** answers *"How do I currently intend to
translate that commitment into coordinated action?"*. A plan is **not** a recommendation, a decision, a commitment,
execution, proof of progress, a task manager, a calendar, an autonomous workflow, or a promise that outcomes will occur.
Only the founder may confirm and activate a plan.

## The sixteen laws

### Law 1 — Commitment precedes plan
An SPR may be created only from an explicit, founder-owned Strategic Commitment Record. **No plan directly from** a
recommendation, a strategic session, a decision without a commitment, a conversation, a model suggestion, or a
recommendation `ACCEPT`.

### Law 2 — Plan is not commitment
A plan structures intended action under a commitment. It does not strengthen, expand, or reinterpret the commitment
silently.

### Law 3 — Plan is not execution
Creating or activating a plan does not mean anything has been performed. **Planned, started, attempted, completed,
verified, and effective are distinct states.** Execution remains future-only; there is no `IN_PROGRESS`/`COMPLETED` state.

### Law 4 — Explicit founder activation
The model may propose a draft (not in this slice). Only the founder may confirm scope, milestones, sequencing, and
assumptions, and **activate** the plan. **No hidden activation, no auto-save as authoritative, no activation from passive
interaction.**

### Law 5 — Bounded scope
The plan must remain within the scope of the linked commitment and must not create obligations outside it.

### Law 6 — No manufactured precision
Business Brain must not invent exact dates, budgets, capacities, conversion assumptions, resource availability,
dependencies, certainty, or operational feasibility. Unknown values remain unknown until founder-confirmed or grounded.

### Law 7 — Milestone is not task
A milestone represents a meaningful strategic state or checkpoint. It must not collapse into a generic checklist item —
no checkboxes, no assignments, no completion state.

### Law 8 — Review before expansion
On contradiction, failed assumptions, insufficient evidence, or changed context, the system surfaces **review**. It must
not silently expand scope or generate more activity to preserve momentum.

### Law 9 — Founder-authored versus model-derived
Every plan element distinguishes founder-authored, founder-confirmed, recommendation-derived, commitment-derived,
model-proposed, and system-derived. Model-proposed text never becomes founder-authored merely through persistence.

### Law 10 — Append-only history
Activated plan versions are immutable. Change requires a revision, supersession, retirement, cancellation, or another
explicitly governed append-only lifecycle event. **No mutable PATCH of historical plans** (enforced in the database).

### Law 11 — No autonomous decomposition
This slice must not automatically decompose milestones into tasks, schedules, calendar events, messages, or agent
actions.

### Law 12 — No retrospective fabrication
Later execution or results must not rewrite assumptions, uncertainty, expected milestones, original sequencing, or the
original evidence state at plan time.

### Law 13 — Honest feasibility
The plan surfaces missing/unavailable resources, conflicting commitments, deadline tension, unresolved dependencies, and
unsupported assumptions. It must not label a plan feasible merely because it is structurally complete.

### Law 14 — Exit and review
Every activated plan has at least one bounded review or exit condition. This creates **no** reminder or scheduler.

### Law 15 — Export, isolation, deletion
Plan history is founder-isolated, inspectable, exportable, account-deletable, and historically linked.

### Law 16 — Constitutional supremacy
Apply the test: **"Does this serve the founder's clarity and sovereignty, or the product's hold?"**

## Authorship boundary

Every field is exactly one of **FOUNDER_AUTHORED** / **FOUNDER_CONFIRMED** (title, intent, milestones, assumptions,
dependencies, review/exit conditions), **COMMITMENT_DERIVED** / **RECOMMENDATION_DERIVED** (context carried verbatim from
the linked commitment/decision, labelled), **MODEL_PROPOSED** (a draft element — not used in this slice), or
**SYSTEM_DERIVED** (links, versions, grounding, alignment, derived status, deterministic conflicts). Never merged.

## Model role (this slice)

**None.** This slice does not use the model to draft plans — the founder authors every plan element, and the plan is
validated deterministically. Because no model draft is produced, no LLM evaluation is added. Model-assisted drafting is
deferred (SP-1); if added later, it must pass deterministic validation, may never activate a plan, and any
provenance-bearing draft claim is subject to Recommendation Provenance Integrity.

## Scope boundary

This slice records founder plans over existing Strategic Commitments. It does **not** add autonomous execution, agents,
background task generation, reminders, calendars, project-management integrations, notifications, scheduling engines,
execution records, tasks, or a knowledge graph; reconcile the legacy `memory.*` schema (KA-2); create generic Strategic
Memory; let the model create/activate a plan; or modify the frozen engine. `strategic-plan-1` is a new, independent
schema version — recommendation/decision/commitment schema/prompt versions are unchanged.
