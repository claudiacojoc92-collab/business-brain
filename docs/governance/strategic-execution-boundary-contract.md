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
