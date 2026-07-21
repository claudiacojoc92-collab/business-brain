# Strategic Execution Boundary — slice closure record

Establishes the truthful boundary between a **Plan** (intended action) and **real-world execution**: an append-only ledger
of **founder testimony** about what happened. The product performs and verifies **nothing**
(`UNVERIFIED_FOUNDER_REPORT` / `NOT_PERFORMED_BY_PRODUCT`). Governance + architecture committed *before* implementation
(`045f228`, atop `048c01b`).

## Audit answer (ADR-015)
**What may Business Brain truthfully say about execution?** — It may record what was *planned*, what the founder *reports*,
what *evidence* the founder references, and what remains *unknown*. It must never claim the action happened because it was
planned / time passed / a box was clicked; that it succeeded because reported; that the *product* executed it; or that
evidence is verified. Four permanently-distinct categories: **Intended / Founder-Reported / Externally-Evidenced /
Product-Performed** — the last is **unsupported**. Classification **A**: Plan and execution were already truthfully
separated (Plan is intention-only; nothing infers/marks execution; Review is labelled testimony); the missing piece was
founder-reported execution accounting, added here.

## Two commits
- **Commit 1 — governance + architecture `045f228`** (docs only): ADR-015 + contract (12 laws) + architecture + audit.
- **Commit 2 — implementation + closure** (this record).

## What was built
- **V083** — `business.execution_report` (append-only, immutable): founder-testimony ledger against a plan
  milestone/plan; explicit sequence/predecessor lineage; CHECK enums + first-event-REPORT; `UNIQUE(founder, plan_logical,
  subject, sequence)` + partial no-fork `UNIQUE(founder, predecessor)` + idempotency; BEFORE-UPDATE/DELETE guards (delete
  gated on `bb.allow_execution_report_delete`). No verified / product-performed column exists.
- **Domain** [`execution-report.ts`](../../apps/api/src/business-model/execution-report.ts): admission gate (owned plan,
  bounded state/kind, REPORT-vs-CORRECT/WITHDRAW head rules), `nextExecutionLineage`, `deriveEffectiveExecution`
  (absence/withdraw → NOT_REPORTED), bounded `normalizeEvidence` (never verifies), `reportedLabel` (never a bare
  "Completed"), views carrying `UNVERIFIED_FOUNDER_REPORT` + `NOT_PERFORMED_BY_PRODUCT` + `evidenceVerified:false`.
- **Repository** [`pg-execution-report.repository.ts`](../../apps/api/src/business-model/pg-execution-report.repository.ts):
  `record` under a per-(founder,plan,subject) advisory lock + idempotency + expected-head check (fork-free CORRECT/WITHDRAW).
- **API** (`strategy.routes.ts`): `POST /strategy/plans/:id/execution-reports` (+ `/:reportId/correct`, `/:reportId/withdraw`),
  `GET .../execution-reports`, `GET .../effective-execution`. Subject validated against the plan revision; server assigns
  sequence/reported_at/provenance; correction/withdraw must reference the current head (`EXECUTION_REPORT_STALE_HEAD`); no
  PATCH/DELETE; no plan mutation; no downstream artifacts; no external action. Stable errors PLAN_NOT_FOUND /
  PLAN_ITEM_NOT_FOUND / EXECUTION_REPORT_NOT_FOUND / _STALE_HEAD / _INVALID_TRANSITION / _IDEMPOTENCY_CONFLICT.
- **UI** (`StrategyPage.tsx` `PlansPanel` + `ExecutionAccounting`): a DISTINCT "Founder-reported execution" section per
  milestone — "No execution report" / "Reported …" (never bare "Completed"); add / correct / withdraw / history / bounded
  evidence. Disclaimers: "Business Brain has not independently verified this action." · "Evidence supplied — not verified."
  · "Not performed by Business Brain." No progress %, no completion ring, no streaks/scores, no warning colours for
  non-reporting.
- **Review boundary — option C (deferred/absent):** execution reports are NOT wired into Review; Review is unchanged.
- **Export/Delete**: export adds `executionReports` (ledger + evidence + unverified/not-performed status); account-delete
  removes them (bypass guard) → zero orphans.

## Acceptance
- **Deterministic** `execution-report.test.ts` (**15**): admission gate, lineage, effective state (absence/withdraw →
  NOT_REPORTED), bounded evidence, report language, constant unverified/not-performed flags.
- **Live A–J** `execution-report.live.test.ts` (**8**): intention≠execution; report + evidence (plan untouched);
  correction (immutable prior, seq 1→2); withdraw → NOT_REPORTED + contiguous re-report; stale-head rejected/no-fork; no
  downstream effects (plan/decision/commitment/review/learning/promotion/snapshot/session all unchanged); isolation +
  append-only + zero-orphan delete; idempotency + sequence-over-timestamp determinism.
- **Playwright** `strategic-execution-boundary.spec.ts`: distinct execution section, "No execution report" + no "%", report
  ATTEMPTED (+ "not verified" + "Not performed by Business Brain"), evidence "supplied — not verified", persist across
  refresh, correct → "Reported completed" (never bare "Completed"), REPORT+CORRECT+WITHDRAW history, plan lifecycle
  unchanged, 0 reviews/sessions, no verified/product column. Evidence: `exec-{no-report,attempted-unverified,reported-
  completed,history,withdrawn}.png`.
- **Regression** — full **`backend` project** (repo root): **1029 pass / 1 skip / 0 fail** (1006 + 23). Web build green;
  **73** web unit tests; API + web typechecks clean; migrations through **V083**; Consumption + Consumption-Gate +
  Promotion Playwright regression green; frozen strategist hashes byte-identical (`a39ea88…` / `79802e9…` / `f9df116…`).

## Scope discipline
No agents, task/browser/email/calendar/CRM/API/webhook automation, action workers, scheduling, reminders, delegated/auto
execution, automatic status/completion, inferred completion, productivity/performance scoring, surveillance, prediction,
gamification, streaks, dependence-nudging, recommendation regeneration, context-change reaction, Strategic Memory,
embeddings, semantic retrieval, or knowledge graphs. The product performs and verifies nothing. Frozen engine
byte-identical. Not deployed, not pushed, no prior commit amended.

## Remaining debt
- **Product-performed execution** (connectors, authorization, action receipts, failure/reversal semantics, security review)
  — a separate future constitutional capability. **Review integration** of execution testimony — deferred. Outcome
  attribution — out of scope. **PI-1 / KA-2** unchanged.
