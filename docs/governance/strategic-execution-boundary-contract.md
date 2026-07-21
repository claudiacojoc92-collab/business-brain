# Strategic Execution Boundary — governance contract

Governs the boundary between **Plan** (intended action) and **real-world execution**. Enacts
[ADR-015](../adr/ADR-015-strategic-execution-boundary.md). Documentation; the implementation slice must satisfy every law.
This slice records **founder testimony** about execution — never a product-performed action.

## Constitutional laws

**L1 — Plan Is Not Execution.** A Plan represents intended action only. Creating, editing, accepting, or viewing a Plan
never proves real-world execution.

**L2 — No Inferred Execution.** The product must not infer execution from elapsed time, deadlines, page visits, clicks,
recommendation acceptance, decision/commitment creation, plan activation, review creation, later outcomes, inactivity, or
external assumptions.

**L3 — Founder Report Is Testimony.** A founder may report an action as NOT_STARTED / ATTEMPTED / COMPLETED / BLOCKED /
ABANDONED / NOT_APPLICABLE. This is founder testimony, not independently verified fact; the UI and API label it so
(`verificationStatus = UNVERIFIED_FOUNDER_REPORT`).

**L4 — Evidence Is Not Automatic Verification.** Evidence may be a NOTE / URL / FILE_REFERENCE / METRIC_OBSERVATION /
EXTERNAL_REFERENCE. Storing evidence does not mean the product verified it; the product never fetches, scrapes, inspects,
or verifies it. Evidence is labelled "supplied — not verified".

**L5 — Product Execution Is a Separate Future Capability.** Product-performed actions require a separate constitutional
amendment, connector/action contracts, user authorization, action receipts, failure semantics, external confirmation,
reversal/compensation rules, security review, and auditability. **None is implemented here**
(`productExecutionStatus = NOT_PERFORMED_BY_PRODUCT`, always).

**L6 — Outcomes Remain Separate.** Execution reports do not prove outcomes; outcomes do not prove execution; correlation is
not causation.

**L7 — Append-Only Accounting.** Execution reporting preserves history. Corrections occur through new events, never silent
mutation of prior testimony (BEFORE-UPDATE + BEFORE-DELETE guards).

**L8 — Named Unknown.** When execution state is not reported, the system says `NOT_REPORTED`. It must not display zero
progress as a factual execution judgment; absence means "no founder report exists".

**L9 — No Automatic Lifecycle Mutation.** Execution reports must not automatically change Decision/Commitment state, rewrite
the Plan, create or complete a Review, create a Strategic Learning, promote a learning, create a Context Snapshot,
regenerate recommendations, or trigger downstream execution.

**L10 — No Product-Hold Optimization.** No streaks, completion pressure, shame language, productivity scores, urgency
badges, red-warning mechanics for ordinary non-reporting, manipulative reminders, or engagement loops.

**L11 — Founder Sovereignty.** The founder can report, correct, withdraw a prior claim (explicit superseding event), leave
state unknown, explain ambiguity, and inspect full provenance.

**L12 — Bounded Claims.** Every execution display distinguishes **planned / reported / evidenced / verified /
product-performed**. For this slice: *verified* = unsupported (no trusted verification mechanism exists);
*product-performed* = unsupported.

## Domain (the testimony ledger)

`ExecutionReport` is append-only + immutable. Subject = an exact **plan revision id** + either a **milestone id**
(`subjectType = MILESTONE`) or the plan itself (`subjectType = PLAN`) — never mutable text alone. Fields: founder id,
subject type/id, plan id, plan revision, `report_sequence` (1..N), `predecessor_report_id`, `report_kind`
(`REPORT | CORRECT | WITHDRAW`), `execution_state`, founder statement (verbatim, bounded), `occurred_at` (nullable,
founder-claimed), `reported_at` (server), `evidence_references` (JSONB, bounded), `idempotency_key`, `source`. No verified
or product-performed field is ever settable by the client.

**Effective state** (`EffectiveExecutionState`) is derived from the sequence/predecessor chain (never `created_at`): head =
highest-sequence event; `REPORT`/`CORRECT` → the reported state; `WITHDRAW` → `NOT_REPORTED`; absence → `NOT_REPORTED`. It
exposes the subject identity, current state (with report language, never bare "Completed"), current event, latest
statement, `occurredAt`, evidence, sequence, provenance, `verificationStatus = UNVERIFIED_FOUNDER_REPORT`, and
`productExecutionStatus = NOT_PERFORMED_BY_PRODUCT`.

## Boundary (deferred; NOT in this slice)
Product-performed execution; connectors/receipts; automatic lifecycle/Review integration; outcome inference; scoring;
reminders/streaks/gamification; Strategic Memory; embeddings; semantic retrieval; knowledge graphs.

## Acceptance
Accept only when: Plan remains intention-only; execution is a separate append-only testimony ledger; nothing infers
execution; the product claims no execution; founder reports + evidence are explicitly labelled unverified;
`productExecutionStatus` is always NOT_PERFORMED_BY_PRODUCT; effective state derives from deterministic lineage;
stale-head/fork writes fail; correction/withdrawal preserve history; no Plan/Decision/Commitment/Review mutation and no
Learning/Promotion/Snapshot/recommendation side effects; no progress percentage / completion score / engagement mechanics;
export complete; deletion zero orphans; genuine rendered Playwright passes; frozen strategist hashes unchanged.

---

## Remediation clarification (2026-07-21) — execution identity is revision-scoped

The initial slice keyed the execution chain on the *logical* plan (revision stored only as metadata), so sequence,
predecessor, effective state, and projection bled across Plan revisions. This clarification makes execution identity
**revision-scoped**. Documentation only.

**R1 — Execution belongs to an exact intention.** The identity of an intention is the exact immutable Plan revision
(`plan_id`). Execution chain identity is **(founder, plan_revision_id, subject)** — never the logical plan.

**R2 — Two revisions are different intentions.** Execution never migrates automatically between revisions. Revision 1 and
Revision 2 have independent chains; a new report on Revision 2 starts sequence 1.

**R3 — No cross-revision linkage.** No predecessor may reference a report on another revision; no correction or withdrawal
may target another revision (rejected). The no-fork guarantee is per revision-chain.

**R4 — Effective state is revision-scoped.** The resolver derives one effective state per (revision, subject). A report on
Revision 2 does not change Revision 1's effective state, and vice-versa; absence on a revision is `NOT_REPORTED` regardless
of other revisions.

**R5 — No inferred continuation.** Business Brain must never infer execution continuity from stable milestone ids or from a
prior revision's reports. Stable milestone ids are structural identity only.

**R6 — UI / export isolation.** The UI shows only the viewed revision's execution; the export preserves lineage + effective
state per revision; reconstructing one revision never reconstructs another's execution.

**R7 — Revised acceptance.** Accept only when chain/sequence/predecessor/effective/API/UI/export identity all include the
exact plan revision, cross-revision correction/withdrawal are rejected, and Playwright proves revision isolation.

---

## Second remediation clarification (2026-07-21) — the database owns structural lineage

The revision-scoping remediation (V084) corrected the *application's* chain identity, but a direct-SQL audit
(`docs/audit/strategic-execution-boundary-db-lineage-audit.md`, classification **B**) proved the **database** still
accepts a predecessor pointing to another revision, another subject, another founder, or a non-adjacent sequence. The
append-only ledger is only constitutionally sound if corrupt cross-chain lineage cannot be inserted through direct SQL, a
future defective code path, a batch import, a migration, another repository, or disabled application validation. These
laws make lineage integrity a database guarantee. Documentation only.

**Law 1 — Database owns structural lineage.** Application validation improves errors and UX but is *not* the final
authority for execution-report lineage. The database must reject structurally invalid predecessor relationships on its own.

**Law 2 — Predecessor must match canonical identity.** A child and its predecessor must match on founder, exact Plan
revision (`plan_id`), subject type, and subject id. Canonical chain identity =
`(founder_id, plan_id, subject_type, subject_id)`.

**Law 3 — Sequence must be adjacent.** For any non-initial event, `child.report_sequence = predecessor.report_sequence + 1`.
A predecessor from an older, non-head sequence is structurally invalid even within the same chain.

**Law 4 — Initial event shape.** The first event of a chain is `kind=REPORT`, `report_sequence=1`,
`predecessor_report_id IS NULL`. No CORRECT or WITHDRAW may begin a chain.

**Law 5 — Non-initial event shape.** Every event with `report_sequence > 1` has a predecessor; every CORRECT and every
WITHDRAW has a predecessor.

**Law 6 — No cross-chain linkage.** The database rejects a predecessor belonging to another founder, another Plan
revision, another subject type, or another subject id.

**Law 7 — No fork.** At most one child may reference a given predecessor. The existing `uniq_exr_predecessor` no-fork
enforcement remains.

**Law 8 — Append-only remains.** No lineage remediation may weaken the UPDATE prohibition, the DELETE prohibition, the
founder-account-deletion behavior, export completeness, or deterministic chain resolution.

**Law 9 — Application and database semantics agree.** Application-level and database-level errors represent the same
constitutional rules. The application must not permit what the database rejects; the database must not permit what the
application considers constitutionally invalid.
