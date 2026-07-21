# Strategic Execution Boundary — architecture record

Implements [ADR-015](../adr/ADR-015-strategic-execution-boundary.md) /
[`strategic-execution-boundary-contract.md`](../governance/strategic-execution-boundary-contract.md). Audit:
[`strategic-execution-boundary-audit.md`](strategic-execution-boundary-audit.md) (classification **A** — Plan/execution
already truthfully separated; the missing piece is founder-reported execution accounting).

## Design

- **V083** — `business.execution_report` (append-only, immutable). Columns: `id`, `founder_id`, `subject_type`
  (`MILESTONE | PLAN`), `subject_id` (milestone id, or plan id for `PLAN`), `plan_id` (exact plan revision id),
  `plan_logical_id`, `plan_revision`, `report_sequence` (1..N per founder/plan/subject), `predecessor_report_id`,
  `report_kind` (`REPORT | CORRECT | WITHDRAW`), `execution_state`
  (`NOT_STARTED|ATTEMPTED|COMPLETED|BLOCKED|ABANDONED|NOT_APPLICABLE`), `founder_statement`, `occurred_at` (nullable),
  `reported_at` (server), `evidence_references` (JSONB — bounded `{type,value,label}` where type ∈
  `NOTE|URL|FILE_REFERENCE|METRIC_OBSERVATION|EXTERNAL_REFERENCE`), `idempotency_key`, `source`, `created_at`. Constraints:
  CHECK enums; `report_sequence > 0`; `UNIQUE(founder, plan_id, subject_id, report_sequence)`; partial
  `UNIQUE(founder, predecessor_report_id)` (no-fork); CHECK (seq 1 ⇒ null predecessor ∧ kind `REPORT`; seq > 1 ⇒ predecessor
  not null); `UNIQUE(founder, idempotency_key)`. BEFORE-UPDATE + BEFORE-DELETE guards (delete gated on
  `bb.allow_execution_report_delete`). No product-execution/verified column exists.
- **Domain** `execution-report.ts`: types + `assertExecutionReportAdmissible` (owned plan + valid subject; bounded state +
  kind; REPORT-vs-CORRECT/WITHDRAW head rules), `buildExecutionReportFields`, `nextExecutionLineage` (sequence/predecessor
  like promotion V080), `deriveEffectiveExecution` (chain head → reported state / NOT_REPORTED), `toExecutionReportView` +
  `toEffectiveExecutionView` (report language, `UNVERIFIED_FOUNDER_REPORT`, `NOT_PERFORMED_BY_PRODUCT`).
- **Repository** `pg-execution-report.repository.ts`: `record` under a per-(founder,plan,subject) advisory lock +
  idempotency (race-free head/no-fork); `listForPlan`, `listForSubject`, `getEffectiveForPlan`.
- **API** (in `strategy.routes.ts`): `POST /strategy/plans/:planId/execution-reports` (kind REPORT),
  `.../:reportId/correct`, `.../:reportId/withdraw`, `GET .../execution-reports`, `GET .../effective-execution`. Subject
  validated against the referenced plan revision (milestone id must exist); server assigns sequence + reported_at +
  provenance; correction/withdraw must reference the current effective head (else `EXECUTION_REPORT_STALE_HEAD`); no PATCH,
  no DELETE, no plan mutation, no downstream artifacts. Stable errors: `PLAN_NOT_FOUND`, `PLAN_ITEM_NOT_FOUND`,
  `EXECUTION_REPORT_NOT_FOUND`, `EXECUTION_REPORT_STALE_HEAD`, `EXECUTION_REPORT_INVALID_TRANSITION`,
  `EXECUTION_REPORT_IDEMPOTENCY_CONFLICT`.
- **UI** (`StrategyPage.tsx`, PlanView): a distinct "Founder-reported execution" section per milestone — "No execution
  report" / "Reported {state}" (never bare "Completed"); add-report / correct / withdraw / history / bounded evidence.
  Disclaimers: "This records your report. Business Brain has not independently verified the action." · "Evidence supplied —
  not verified." · "Not performed by Business Brain." No progress %, no completion ring, no streaks/scores, no warning
  colours for non-reporting.
- **Review boundary — option C (deferred/absent):** execution reports are NOT wired into Review computation. Review is
  unchanged; its `CONDITION_MET` stays condition-assessment testimony, distinct from execution reports.
- **Export/Delete:** export adds `executionReports` (ledger + evidence + effective provenance + unverified/not-performed
  status); account-delete removes them (bypass guard) → zero orphans.

## Invariants
Plan/Decision/Commitment/Review unchanged; no inferred/product execution; deterministic lineage; stale-head/fork rejected;
append-only; no downstream side effects; no progress/score/engagement mechanics; frozen strategist engine untouched.
Deferred: product execution, connectors/receipts, Review integration, outcome inference, scoring, memory/graphs/embeddings.

---

## Remediation architecture (2026-07-21) — revision-scoped execution identity

**Audit (code-traced):** chain identity was `(founder, plan_logical_id, subject)` across V083 `uniq_exr_chain_sequence` /
`idx_exr_effective`, the repo advisory lock + `listForPlan`, the API `resolveExecutionSubject` (`planRepo.getEffective`),
the effective route, the UI `getEffectiveExecution(logicalPlanId)`, and the export ordering. `plan_id`/`plan_revision` were
metadata only → **classification B (revision-tagged)**.

**Changed to `(founder, plan_id, subject)`:**
- **V084** — drop + recreate the chain/effective indexes on `plan_id` (revision) instead of `plan_logical_id`:
  `uniq_exr_chain_sequence (founder_id, plan_id, subject_type, subject_id, report_sequence)` +
  `idx_exr_effective (founder_id, plan_id, subject_type, subject_id, report_sequence DESC)`. No data migration (0 rows).
- **Repository** — advisory lock keyed on `plan.id`; `listForRevision(founderId, planId)` (by `plan_id`) replaces the
  logical listing for chain/effective/head; `record` computes lineage from the revision's events only.
- **API** — new `planRepo.getByRevisionId(founderId, planRevisionId)`; execution routes take the **exact plan revision id**
  (`:planId`); subject validated against that revision's milestones; correction/withdrawal require the referenced report's
  `plan_id` to equal the resolved revision (cross-revision → rejected). Effective route lists reports for that `plan_id`.
- **UI** — `PlansPanel`/`ExecutionAccounting` call execution routes with `plan.planId` (the revision id); each revision
  shows only its own execution.
- **Export** — ordered by `plan_id, subject, report_sequence` so revisions are isolated.

**Invariant:** no chain, sequence, predecessor, effective projection, UI view, or export spans two plan revisions.
