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

---

## Remediation amendment (2026-07-21) — execution identity is REVISION-SCOPED, not revision-tagged

**Verdict of the audit:** the initial slice (`77a5b63`) recorded `plan_id`/`plan_revision` as *metadata* on each event, but
the execution **chain identity** was keyed on **(founder, logical_plan, subject)** — the unique/no-fork indexes, the
sequence, the predecessor lookup, the advisory lock, the effective-state resolver, the API subject resolution, the UI
projection, and the export all operated on the *logical* plan. Consequences: a report on Revision 1's milestone and a later
report on Revision 2's same milestone id continue **one** chain (sequence spans revisions), and effective state resolves
**across** revisions. That is a constitutional ambiguity: execution history bled between two *different intentions*.

### Execution belongs to an exact intention (the immutable Plan revision)
The identity of an intention is the **exact immutable Plan revision** (`plan_id`). Two revisions are constitutionally
different intentions. Execution **never migrates automatically** between them. Business Brain must never infer "because
Revision 1 was attempted, Revision 2 inherits that execution," nor "because milestone ids stayed stable, execution
continues." **Stable milestone ids are structural identity; execution identity additionally requires the exact Plan
revision.** A founder may deliberately begin executing Revision 2 — that starts a **new, independent** execution chain.

### The required identity (this remediation, V084)
Execution chain identity becomes **(founder, plan_revision_id, subject)**. Invariants:
- Revision 1 sequences 1,2,3…; Revision 2 sequences **restart at 1**, independently.
- No predecessor may reference a report on another revision; no correction/withdrawal may target another revision.
- The effective-state resolver is **revision-scoped**: Revision 1 = "Reported attempted" and Revision 2 (same milestone id,
  no reports) = "No execution report" — simultaneously, each unaffected by the other.
- The UI shows **only** the viewed revision's execution; the export isolates lineage + effective state **per revision**; a
  consumer reconstructing Revision 1 can never accidentally reconstruct Revision 2's execution.

### Plan-revision id strategy (audited)
Plan revisions are append-only immutable rows with distinct `plan_id`s; milestone ids may be founder-supplied (stable) or
regenerated per revision (`m{n}`). Either way, revision-scoping holds: scoping on `plan_id` isolates chains even when
milestone ids are identical across revisions, and when ids regenerate the subject also differs — so revision isolation is
enforced independently of the milestone-id strategy.

### Revised acceptance rule
Accept only when chain identity, sequence, predecessor, effective state, API resolution, UI projection, and export are all
scoped to `(founder, plan_revision_id, subject)`; correction/withdrawal cannot cross revisions; and Playwright proves that
Revision 1 shows only Revision 1 execution and Revision 2 shows only Revision 2 execution.

---

## Third clarification (2026-07-21) — database-enforced lineage integrity

**Why a third pass.** Revision-scoping (V084) fixed the *application's* chain identity, but a direct-SQL audit
(classification **B**) showed the **database** would still accept a predecessor from another revision, subject, founder,
or a non-adjacent sequence: `predecessor_report_id` had no foreign key and no trigger comparing chain identity or
sequence. Chain integrity was application-only.

**Governing answer.** The database must independently guarantee that every predecessor relationship stays inside one
canonical execution-report chain — `(founder_id, plan_id, subject_type, subject_id)` — with `child.report_sequence =
predecessor.report_sequence + 1`. A valid predecessor must not depend only on route or repository validation, because the
append-only ledger is constitutional only if corrupt cross-chain lineage cannot enter through direct SQL, a future
defective code path, a batch import, a migration error, another repository, or disabled application validation. See Laws
1–9 in the governance contract and the V085 remediation.
