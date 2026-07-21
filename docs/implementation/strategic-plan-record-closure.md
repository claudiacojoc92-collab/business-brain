# Strategic Plan Record — slice closure record

Opens ADR-011 **category 12 (Plan)**: a founder-explicit, append-only translation of ONE effective Strategic Commitment
into intended strategic moves, milestones, review conditions, assumptions, and dependencies. Governance + architecture
gate committed *before* implementation (`c104cfb`, atop the SCR line `1ebbfc0`).

## Gate (committed first — `c104cfb`)

- **Audit (Part 1):** no existing structure is a plan. `recommendation.nextStep` is a model field inside the **immutable
  recommendation** (not a plan); commitment `governedBehavior` is founder-authored (not a plan); commitment review
  conditions are **not** milestones; the `app.*_projection` tables are legacy M2 read projections (matched the audit
  regex on "project*ion"); the legacy `decision.ts`/`memory.*` is untouched (KA-2). No `plan`/`task`/`milestone`/
  `execution` table; no UI action implicitly creates a plan; no model output persists planning objects.
- **Governance contract** — [`strategic-plan-record-contract.md`](../governance/strategic-plan-record-contract.md): 16
  laws (commitment-precedes-plan; not-commitment; not-execution — no `IN_PROGRESS`/`COMPLETED`; explicit founder
  activation; bounded scope; no manufactured precision; milestone-is-not-task; review-before-expansion; founder vs
  model-derived; append-only; no autonomous decomposition; no retrospective fabrication; honest feasibility; exit/review
  mandatory; export/isolation/delete; constitutional supremacy).
- **Architecture record** — [`strategic-plan-record-slice.md`](../architecture/strategic-plan-record-slice.md): one
  append-only table, deterministic admission gate + feasibility conflicts, schema `strategic-plan-1`. **Model role: none**
  this slice.

## What was built (implementation — `c104cfb`+1)

**Domain** — [`strategic-plan.ts`](../../apps/api/src/business-model/strategic-plan.ts): the deterministic admission gate
`assertPlanAdmissible` (owned + **ACTIVE** commitment; supported commitment schema; title + intent; scope ≤ commitment
scope with `COMMITMENT_SCOPE` inheriting; ≥1 milestone **or** a no-milestone rationale; ≥1 review/exit/expiry; grounding
**inherited, never upgraded**; insufficiency acknowledged; expiry not in the past); `computePlanConflicts` (deterministic
feasibility: `MILESTONE_AFTER_EXPIRY`/`NON_NEGOTIABLE_DEPENDENCY` → **BLOCKING**; `UNAVAILABLE_DEPENDENCY`/
`CONTRADICTED_ASSUMPTION`/`PLAN_EXPIRY_AFTER_COMMITMENT_EXPIRY` → **REVIEW_REQUIRED**; `UNKNOWN_*` → **NON_BLOCKING**;
BLOCKING refuses activation, others surface); `effectiveStatus` (lifecycle-derived + read-time `EXPIRED`);
`linkedCommitmentStatus` (neutral notice when the linked commitment changes — never auto-terminates); `buildPlanFields`
(exact commitment-revision links; founder text verbatim; milestones sorted by `sequence`; authorship map). **The model is
never in this path** (no draft generation this slice).

**Persistence** — `V074 business.strategic_plan_record` (append-only immutable revisions keyed by `(founder,
logical_plan_id, revision)`; **BEFORE-UPDATE trigger**; unique `(founder, idempotency_key)`; milestones/assumptions/
dependencies/conflicts as JSONB — no task/milestone table).
[`pg-strategic-plan.repository.ts`](../../apps/api/src/business-model/pg-strategic-plan.repository.ts): idempotent
create+activate; append-only supersede/retire/cancel; list/getHistory/getEffective with derived status incl. expiry.

**API** — [`strategy.routes.ts`](../../apps/api/src/routes/strategy.routes.ts):
`POST /strategy/commitments/:logicalCommitmentId/plans` (create+activate, gated, idempotent), `GET /strategy/plans`,
`GET /strategy/plans/:logicalPlanId` (+ history + `linkedCommitmentStatus`), `POST …/supersede|retire|cancel`. No draft
route (no model drafts), no PATCH, no task/schedule/execution endpoints. Cross-founder → 404.

**Export/Delete** — export adds `strategicPlans` (all revisions + commitment/decision/recommendation/manifest links +
milestones + assumptions + dependencies + review/exit + conflicts + labelled `authorship`); account deletion removes
`business.strategic_plan_record` before the commitment delete (zero orphans).

**UI** — [`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx): a **separate** "Create a plan" surface,
offered only after a commitment is recorded (a commitment does not auto-become a plan). The founder authors title, intent,
scope, milestones, assumptions, review/exit conditions, optional review date; the deterministic conflicts render; states
"This activates a plan." + "It does not execute tasks or create calendar events."; an INSUFFICIENT lineage requires a
fresh acknowledgement; an explicit **Activate this plan**. Neutral lifecycle; no personality/coercive language, no progress
percentage, no fake completion. Schema `strategic-plan-1` (recommendation/decision/commitment schemas unchanged).

## Acceptance evidence

- **Deterministic (Part 14):** `strategic-plan.test.ts` — 22 tests (admission gate: inactive-commitment, title/intent,
  scope-≤-commitment, milestone-or-rationale, review-mechanism, past-expiry, milestone-after-expiry BLOCKING,
  insufficiency-ack; deterministic conflicts BLOCKING/REVIEW/NON_BLOCKING; build/linkage; grounding inheritance; authorship;
  milestone ordering; no execution/task fields; lifecycle + `EXPIRED`; linked-commitment status).
- **Live DB (Part 15 + Scenarios):** `strategic-plan.live.test.ts` — 9 tests covering cases 1–7, 9–10, 13, 16, 28–39: a
  commitment creates **no** plan (and no task/execution table); explicit activation exactly-once + idempotent; exact
  commitment-revision + manifest linkage; a later commitment revision does **not** rewrite the plan (stays ACTIVE with a
  `COMMITMENT_SUPERSEDED` notice — not auto-terminated); released/retired commitment cannot receive a plan; append-only
  UPDATE rejected; supersede + retire + cancel preserve prior and a terminal plan cannot be re-terminated; `EXPIRED`
  derived at read; cross-founder commitment-link + plan-read rejected without leakage; export faithful (authorship
  preserved), deletion zero orphans, no `memory.*` write.
- **Browser (Part 16):** decision → commitment → plan are three **separate** acts — recording a commitment reveals a
  distinct "Create a plan" affordance ("a separate step — and it doesn’t execute anything"). Activating a plan through the
  real UI→API persisted revision 1 / CREATE / **ALIGNED** + **GROUNDED** (inherited) / `COMMITMENT_SCOPE` / 2 milestones /
  linked to the exact commitment revision; the recorded state and list-back show `ACTIVE`, `notExecution: true`, and "It
  does not execute work or create tasks".
- **Regression:** backend **873 pass / 1 skip**; web build (tsc + vite) + 73 web tests green; API + web typechecks clean;
  migrations V066–V074 present, V074 table + append-only trigger live; frozen-engine hashes byte-identical; Strategic
  Decision + Commitment + provenance (KA-1) + conflict rules remain green; recommendation `ACCEPT` and BU `accept`
  semantics unchanged; commitment creation does not create a plan. (Two live-test table-existence assertions were narrowed
  to row-counts + `strategic_task`/`strategic_execution` — the new plan table legitimately exists.)

## Scope discipline

No autonomous execution, agents, background task generation, reminders, calendars, project-management integrations,
notifications, scheduling engines, execution records, tasks, or a knowledge graph added; the legacy `memory.*` schema
(KA-2) not reconciled; no generic Strategic Memory; the model cannot create/activate a plan (no drafting this slice); a
commitment never auto-becomes a plan; the frozen engine untouched. Not deployed, not pushed, no prior commit amended.

## Remaining debt
- **SP-1** model-assisted draft generation (deterministic validation + provenance + evaluation).
- **SP-2** FSC/resolver-computed NON_NEGOTIABLE feasibility (currently founder-declared only).
- Strategic **Execution Record** remains future-only; Strategic **Memory** is not implemented; **PI-1** / **KA-2** unchanged.
