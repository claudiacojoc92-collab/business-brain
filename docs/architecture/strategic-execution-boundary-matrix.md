# Strategic Execution Boundary — criterion-to-test matrix

Maps the Part 13 criteria to their covering tests. **det** = `apps/api/src/__tests__/business-model/execution-report.test.ts`;
**live** = `execution-report.live.test.ts` (A–J); **e2e** = `apps/web/e2e/strategic-execution-boundary.spec.ts`. Impl:
**dom** = `execution-report.ts`; **repo** = `pg-execution-report.repository.ts`; **api** = `strategy.routes.ts`; **mig** =
`V083__execution_report.sql`; **exp/del** = `export.service.ts` / `delete.service.ts`; **ui** = `StrategyPage.tsx`
(`ExecutionAccounting` / `PlansPanel`).

| # | Criterion | Impl | Test | Status |
|---|---|---|---|---|
| 1–5 | creating/activating/viewing a Plan or Review, or time passing, creates no execution report | api | live A (0 reports on a plan) · e2e (both items "No execution report") | COVERED |
| 6–9 | an execution report changes no Plan/Decision/Commitment/Review state | api/repo | live G/H (counts unchanged; review byte-equal) · e2e (plan lifecycle CREATE unchanged, 0 reviews) | COVERED |
| 10–12 | no Learning created / no recommendation regenerated / no external action | api | live H (learning/promotion/snapshot/session counts unchanged) | COVERED |
| 13–16 | valid founder-owned plan item accepts a report; foreign/missing plan/item rejected | api/repo | live A/B · e2e · route PLAN_NOT_FOUND/PLAN_ITEM_NOT_FOUND | COVERED |
| 17–20 | state enum bounded; occurredAt optional; reportedAt server-controlled; statement preserved | dom | det (bounded state; build) · live B | COVERED |
| 21–23 | evidence preserved; client cannot claim verified / product-performed | dom/mig | det (evidence; no verified field) · live B · e2e (no verified/product cols) | COVERED |
| 24–26 | initial sequence 1; predecessor null; first event REPORT | dom/mig | det (nextLineage) · live B · CHECK constraint | COVERED |
| 27–35 | correction appends; prior immutable; seq increments; predecessor = head; no fork | dom/repo/mig | det (lineage) · live D/F · e2e (history REPORT+CORRECT) | COVERED |
| 36–42 | withdrawal appends; prior stays; effective NOT_REPORTED; history visible; stale rejected; REPORT-after-withdraw contiguous | dom/repo | det (withdraw→NOT_REPORTED) · live E/F · e2e (withdraw label + history) | COVERED |
| 43–52 | effective state (absence/withdraw→NOT_REPORTED); UNVERIFIED_FOUNDER_REPORT; NOT_PERFORMED_BY_PRODUCT; sequence-ordered | dom | det (43–49) · live B/D/E · e2e | COVERED |
| 53–59 | evidence bounded, labelled unverified; URL not fetched; nothing set verified | dom/api | det (evidence; INVALID_EVIDENCE) · live B/C · e2e ("Evidence supplied — not verified") | COVERED |
| 60–66 | plan text/lifecycle/history unchanged; composed separately; no bare "Completed"; no % / score | api/ui/dom | live B (plan untouched) · e2e (lifecycle CREATE; "Reported completed"; no "%") · det (reportedLabel) | COVERED |
| 67–70 | Review boundary = deferred/absent; no verified conversion; no outcome inference; Review tests green | (no wiring) | live G · full Review-test regression | COVERED |
| 71–77 | idempotency; concurrent no-fork; foreign inaccessible; no PATCH/ordinary DELETE | repo/mig/api | live I/J · uniq_exr_predecessor · route (no PATCH/DELETE) | COVERED |
| 78–83 | UPDATE/DELETE rejected at DB; export full; account-delete zero orphans; prior history byte-equal; frozen hashes | mig/exp/del | live I · export mapping · orphan sweep · hash check | COVERED |

**Deferred (unchanged):** product-performed execution; connectors/receipts; automatic lifecycle/Review integration; outcome
inference; scoring/streaks/gamification; Strategic Memory; embeddings; semantic retrieval; knowledge graphs.

---

## Remediation matrix (2026-07-21) — revision-scoped execution identity

Impl: **mig** = `V084__execution_report_revision_scoped.sql` (indexes on `plan_id`); **dom** = `execution-report.ts`
(`chainHead`/`nextExecutionLineage`/`isActivelyReported`/`deriveEffectiveExecution` now `planId`-scoped); **repo** =
`pg-execution-report.repository.ts` (`listForRevision`/`getEffectiveForRevision`, lock on `plan.id`); **api** =
`strategy.routes.ts` (`:planId` = revision; `planRepo.getByRevisionId`; cross-revision rejected); **ui** = `StrategyPage.tsx`
(`PlansPanel` renders every revision with its own `ExecutionAccounting` keyed on `plan.planId`); **exp** = export orders by
`plan_id`. **det** = `execution-report.test.ts` (revision-isolation block); **live** = `execution-report.live.test.ts`
(K/L/E-F); **e2e** = `strategic-execution-boundary.spec.ts`.

| Part-11 # | Criterion | Impl | Test | Status |
|---|---|---|---|---|
| 1 | Rev 1 report, Rev 2 absent → Rev 2 NOT_REPORTED | dom/repo/api | det (1) · live K · e2e (Rev 2 "No execution report") | COVERED |
| 2 | Rev 2 report → Rev 1 unchanged | dom | det (2) · live L · e2e (Rev 1 still "Reported completed") | COVERED |
| 3 | correction cannot cross revisions | api/repo | live E/F · e2e DB (no cross-revision predecessor) | COVERED |
| 4 | withdrawal cannot cross revisions | api/repo | live E/F | COVERED |
| 5 | sequence resets to 1 for a new revision | dom/mig | det (1) · live L (seq 1) · e2e (min seq Rev 2 = 1) | COVERED |
| 6 | Rev 1: 1→2→3 · Rev 2: 1→2 independent | dom/mig | det (1) · live L | COVERED |
| 7 | no-fork enforced within a revision | mig/repo | live F (STALE_HEAD) · uniq_exr_predecessor | COVERED |
| 8 | no-fork irrelevant across revisions (independent chains) | dom/mig | det (7/8) · uniq_exr_chain_sequence on plan_id | COVERED |
| 9 | effective projection isolated per revision | dom | det (2/9) · live K/L · e2e | COVERED |
| 10 | export isolated per revision (ordered by plan_id) | exp | export ordering by plan_id | COVERED |
| 11 | UI isolated (each revision its own execution) | ui | e2e (Rev 1 + Rev 2 distinct blocks/state) | COVERED |
| 12 | Playwright proves Rev 1 shows only Rev 1, Rev 2 only Rev 2 | ui | **e2e** (+ evidence exec-rev1/rev2 PNGs) | COVERED |

**Invariant proved:** no chain / sequence / predecessor / effective projection / UI view / export spans two plan revisions.
