# ADR-015 — Strategic Execution Boundary

**Status:** Accepted — governance gate. **Documentation only**; no runtime behavior, schema, API, migration, or
frozen-engine change in this record. Establishes the constitutional and technical boundary between a **Plan** (intended
action) and **real-world execution**, and defines the *only* truthful thing Business Brain may record about execution: an
append-only ledger of **founder testimony**, never a product-performed action.
**Relationship to prior records:** within [ADR-011](ADR-011-knowledge-architecture.md); sits downstream of Plan (V074) and
alongside Review (V075). Governed by [`strategic-execution-boundary-contract.md`](../governance/strategic-execution-boundary-contract.md);
architecture in [`strategic-execution-boundary-slice.md`](../architecture/strategic-execution-boundary-slice.md); audit in
[`strategic-execution-boundary-audit.md`](../architecture/strategic-execution-boundary-audit.md).

## Scope guard (this slice)
This is **NOT** an autonomous-execution slice. It implements **no** agents, task/browser/email/calendar/CRM automation,
external API actions, webhooks, background action workers, scheduling, reminders, delegated execution, automatic status
changes, inferred/automatic completion, productivity/performance scoring, surveillance, progress prediction, gamification,
streaks, dependence-nudging, recommendation regeneration, context-change reactions, Strategic Memory, embeddings, semantic
retrieval, or knowledge graphs. It exists **only** to establish a truthful execution-accounting boundary.

## Part 1 — The architectural question

**"What may Business Brain truthfully say about execution?"**

Four permanently-distinct categories of execution claim:

1. **Intended Action** — what the Plan lays out. (Exists as the Plan; intention only.)
2. **Founder-Reported Action** — what the founder *says* happened. **Testimony**, not verified fact. (This slice.)
3. **Externally Evidenced Action** — a bounded reference the founder attaches (note/URL/file/metric/external ref).
   Supplied, **not verified** by the product. (This slice, as unverified references.)
4. **Product-Performed Action** — the product itself performed the action. **Unsupported.** (A separate future capability.)

> Business Brain may record **what was planned**, **what the founder reports doing**, **what evidence the founder
> references**, and **what remains unknown**. It must **never** claim: that an action happened because it was planned, or
> because time passed, or because a checkbox was clicked without provenance; that an action succeeded because the founder
> reported completion; that the product executed the action; that an outcome was caused by the action; or that evidence is
> verified when it has not been independently verified.

## Part 2 — Decision: a separate append-only Execution Report ledger of founder testimony

Execution is represented by a **new append-only ledger** (`ExecutionReport`, V083) — **not** by overloading Plan status and
**not** by turning Plan milestones into task-manager records. Each report references a **stable immutable plan element**
(the exact plan revision id + a milestone id, or the plan itself), records a **bounded execution state** the founder
declares, the founder's exact statement, an optional claimed `occurredAt`, a server-controlled `reportedAt`, and bounded
**evidence references**. Effective founder-reported state is derived from an explicit **sequence/predecessor chain** (never
`created_at`), like the Promotion ledger (V080). Corrections and withdrawals are **new events**, never mutations.

**Bounded execution states:** `NOT_STARTED | ATTEMPTED | COMPLETED | BLOCKED | ABANDONED | NOT_APPLICABLE`. The **absence**
of any report is `NOT_REPORTED` (there is no "unknown" event — absence carries that meaning). **Report kinds:**
`REPORT | CORRECT | WITHDRAW`. A `WITHDRAW` returns effective state to `NOT_REPORTED`; a later `REPORT` continues the same
chain (next contiguous sequence). Every effective item exposes `verificationStatus: UNVERIFIED_FOUNDER_REPORT` and
`productExecutionStatus: NOT_PERFORMED_BY_PRODUCT`, and the UI/API never render a bare "Completed" — only "Reported
completed".

**Review boundary (Part 11 option C — deferred/absent):** execution reports are **not** wired into Review computation in
this slice. Review's existing `MilestoneAssessment` (e.g. `CONDITION_MET`) remains *condition-assessment testimony* and is
kept entirely distinct; no execution report is converted into verified fact, and no outcome causality is inferred.

**Plan boundary:** the Plan stays an intention artifact — untouched in text, lifecycle, and history. The canonical Plan
view may *compose* the plan intention with a founder-reported execution **summary**, kept visually and structurally
distinct (never flattened into the plan record).

### Why a separate ledger, not Plan status?
Overloading Plan status would make "the plan advanced" indistinguishable from "the founder reports acting" and from "the
product acted" — the exact conflation this boundary exists to forbid. A separate testimony ledger keeps intention, report,
evidence, verification, and product-performance permanently distinguishable, append-only, and auditable, and leaves
product-performed execution as an explicitly unsupported future capability.
